// Provider webhooks (POST /api/webhooks/:provider) + the sandbox payout simulator that produces them.
//
// Verification first: a request whose signature fails is recorded under a random id (so an attacker can't
// pre-claim a real event id) and rejected with 401. Verified events are idempotent by (provider, event_id).
// This is the ONLY code path that may move a payout to processing / completed / failed.

import { randomUUID } from "node:crypto";
import type { PayoutStatus } from "@/lib/api-types";
import type { Sql } from "./db";
import { big, date, str } from "./db/rows";
import { audit } from "./audit";
import { clock } from "./clock";
import { env } from "./env";
import { HttpError, notFound } from "./errors";
import { addTimeline } from "./indexer";
import { notifyPayout } from "./messages";
import { ONE, trimDecimal } from "./money";
import { payoutProviders, type PayoutWebhookEvent } from "./providers";
import { SANDBOX_ID, SIGNATURE_HEADER, SIMULATED_DETAIL, sandboxSign } from "./providers/sandbox";

const ALLOWED: Record<string, PayoutStatus[]> = {
  requested: ["processing", "failed"],
  processing: ["completed", "failed"],
};

export interface WebhookResult {
  received: true;
  duplicate?: boolean;
  ignored?: string;
  status?: PayoutStatus;
}

export async function handleProviderWebhook(sql: Sql, providerId: string, headers: Headers, rawBody: string): Promise<WebhookResult> {
  const provider = payoutProviders[providerId];
  if (!provider) throw notFound("Unknown provider");
  if (rawBody.length > 32_000) throw new HttpError(413, "payload_too_large", "Webhook body too large");
  const nowSec = Math.floor(clock.now().getTime() / 1000);
  if (!provider.verifyWebhook(headers, rawBody, nowSec)) {
    await sql`INSERT INTO provider_webhooks (provider, event_id, payload, signature_valid, processing_status, error, received_at)
              VALUES (${providerId}, ${`invalid:${randomUUID()}`}, ${{ bytes: rawBody.length }}::jsonb, FALSE, 'rejected', 'invalid or stale signature', ${clock.now()})`;
    throw new HttpError(401, "invalid_signature", "Webhook signature is invalid or too old");
  }
  let ev: PayoutWebhookEvent;
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
    ev = provider.parseWebhook(rawBody);
  } catch (e) {
    throw new HttpError(400, "invalid_payload", `Webhook payload rejected: ${(e as Error).message}`);
  }

  return sql.begin(async (tx) => {
    const ins = await tx<{ id: string }>`
      INSERT INTO provider_webhooks (provider, event_id, payload, signature_valid, processing_status, received_at)
      VALUES (${providerId}, ${ev.id}, ${payload}::jsonb, TRUE, 'received', ${clock.now()})
      ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`;
    if (!ins.length) return { received: true, duplicate: true };
    const hookId = ins[0].id;
    const finish = async (status: "processed" | "rejected" | "failed", error: string | null) => {
      await tx`UPDATE provider_webhooks SET processing_status = ${status}, error = ${error}, processed_at = ${clock.now()} WHERE id = ${hookId}`;
    };
    const [p] = /^[0-9a-f-]{36}$/i.test(ev.payoutId)
      ? await tx<Record<string, unknown>>`SELECT * FROM payout_requests WHERE id = ${ev.payoutId} AND provider = ${providerId} FOR UPDATE`
      : [];
    if (!p || str(p.provider_reference) !== ev.providerReference) {
      await finish("failed", "unknown payout");
      return { received: true, ignored: "unknown_payout" };
    }
    const from = String(p.status);
    if (from === ev.status) {
      await finish("processed", "no-op (same status)");
      return { received: true, status: ev.status };
    }
    if (!(ALLOWED[from] ?? []).includes(ev.status)) {
      await finish("rejected", `invalid transition ${from} -> ${ev.status}`);
      return { received: true, ignored: "invalid_transition" };
    }
    const simulated = Boolean(p.simulated);
    const base = ev.detail ? ev.detail : null;
    const detail = simulated ? (base && base.includes(SIMULATED_DETAIL) ? base : base ? `${SIMULATED_DETAIL}. ${base}` : SIMULATED_DETAIL) : base;
    await tx`UPDATE payout_requests SET status = ${ev.status}, status_detail = ${detail}, updated_at = ${clock.now()} WHERE id = ${String(p.id)}`;
    const transferId = String(p.transfer_id);
    await addTimeline(tx, { transferId, kind: `payout_${ev.status}` as "payout_processing", source: "sandbox", detail });
    if (ev.status === "completed" || ev.status === "failed") {
      await notifyPayout(
        tx,
        { payoutId: String(p.id), transferId, userId: String(p.user_id), currency: String(p.destination_currency), amount: trimDecimal(p.payout_amount) },
        ev.status === "completed" ? "payout_completed" : "payout_failed",
      );
    }
    await audit(tx, `provider:${providerId}`, "payout_status", String(p.id), { from, to: ev.status, eventId: ev.id, simulated });
    await finish("processed", null);
    return { received: true, status: ev.status };
  });
}

// ---------------------------------------------------------------- sandbox simulator (worker)

/** Demo rule: transfers whose MUSD amount ends in .13 (e.g. 25.13 MUSD) always fail the simulated payout. */
export function sandboxShouldFail(amount: bigint): boolean {
  return amount % ONE === 13n * 10n ** 16n;
}

export type WebhookDeliver = (rawBody: string, signatureHeader: string) => Promise<void>;

/** POSTs to the web app's webhook endpoint; if the app is unreachable (e.g. local single process), handles it in-process. */
export function httpDeliver(sql: Sql): WebhookDeliver {
  return async (rawBody, signature) => {
    try {
      const res = await fetch(env.sandboxWebhookUrl(), {
        method: "POST",
        headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signature },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok || res.status === 401 || res.status === 400) return;
      throw new Error(`webhook endpoint answered ${res.status}`);
    } catch (e) {
      console.warn("[sandbox] webhook POST failed, delivering in-process:", (e as Error).message);
      await handleProviderWebhook(sql, SANDBOX_ID, new Headers({ [SIGNATURE_HEADER]: signature }), rawBody);
    }
  };
}

/** In-process delivery (tests, and `--once` local runs). Still goes through signature verification. */
export function inProcessDeliver(sql: Sql): WebhookDeliver {
  return async (rawBody, signature) => {
    await handleProviderWebhook(sql, SANDBOX_ID, new Headers({ [SIGNATURE_HEADER]: signature }), rawBody);
  };
}

/**
 * Advance simulated payouts one step per pass: requested → processing after SANDBOX_PROCESSING_AFTER_SECONDS (10 s),
 * processing → completed (or failed, see sandboxShouldFail) after SANDBOX_COMPLETE_AFTER_SECONDS (30 s), both
 * counted from the request. Each step is a signed webhook with a deterministic event id.
 */
export async function advanceSandboxPayouts(sql: Sql, deliver: WebhookDeliver = httpDeliver(sql)): Promise<number> {
  if (!env.providerWebhookSecret(SANDBOX_ID)) return 0;
  const now = clock.now();
  const rows = await sql<Record<string, unknown>>`
    SELECT p.id, p.status, p.provider_reference, p.created_at, t.amount
    FROM payout_requests p JOIN transfers t ON t.id = p.transfer_id
    WHERE p.provider = ${SANDBOX_ID} AND p.status IN ('requested', 'processing') ORDER BY p.created_at ASC LIMIT 100`;
  let sent = 0;
  for (const r of rows) {
    const ageSec = (now.getTime() - date(r.created_at).getTime()) / 1000;
    let type: PayoutWebhookEvent["type"] | null = null;
    let detail: string | null = null;
    if (r.status === "requested" && ageSec >= env.sandboxProcessingAfterSec()) {
      type = "payout.processing";
      detail = `${SIMULATED_DETAIL}. Sandbox is processing the payout.`;
    } else if (r.status === "processing" && ageSec >= env.sandboxCompleteAfterSec()) {
      if (sandboxShouldFail(big(r.amount))) {
        type = "payout.failed";
        detail = `${SIMULATED_DETAIL}. Simulated failure: amounts ending in .13 MUSD always fail in the sandbox (demo of failure handling).`;
      } else {
        type = "payout.completed";
        detail = `${SIMULATED_DETAIL}. Sandbox marked the payout completed.`;
      }
    }
    if (!type) continue;
    const event = {
      id: `evt_${String(r.id)}_${type.split(".")[1]}`,
      type,
      createdAt: now.toISOString(),
      data: { payoutId: String(r.id), providerReference: String(r.provider_reference), detail },
    };
    const body = JSON.stringify(event);
    try {
      await deliver(body, sandboxSign(body, Math.floor(now.getTime() / 1000)));
      sent++;
    } catch (e) {
      console.warn("[sandbox] delivery failed", String(r.id), (e as Error).message);
    }
  }
  return sent;
}
