// One worker pass: indexer (+ periodic reconciliation) → expiry sweep → pending-hint sweep → sandbox payout
// simulator → email deliveries → heartbeat. Used by worker/run.ts and POST /api/indexer/sync (cron fallback).

import { isDeployed } from "@/lib/chain/config";
import type { Sql } from "./db";
import { getChain, type ChainAdapter } from "./chain";
import { clock } from "./clock";
import { env } from "./env";
import { runIndexerPass, type IndexerPassResult } from "./indexer";
import { deliverEmails } from "./notify";
import { pruneRateLimits } from "./ratelimit";
import { expirySweep, pendingTxSweep } from "./sweeps";
import { advanceSandboxPayouts, httpDeliver, type WebhookDeliver } from "./webhooks";

type Step<T> = T | { error: string } | null;
export interface WorkerPassResult {
  ok: boolean;
  indexer: Step<IndexerPassResult>;
  expiry: Step<number>;
  pending: Step<{ checked: number; failed: number }>;
  payouts: Step<number>;
  emails: Step<{ sent: number; failed: number; retried: number }>;
  ms: number;
}

const errOf = (e: unknown) => ({ error: e instanceof Error ? e.message.split("\n")[0].slice(0, 300) : String(e) });

export async function heartbeat(sql: Sql, name: string, detail: Record<string, unknown>) {
  await sql`INSERT INTO worker_heartbeat (name, detail, updated_at) VALUES (${name}, ${detail}::jsonb, ${clock.now()})
            ON CONFLICT (name) DO UPDATE SET detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at`;
}

let passes = 0;

export async function runWorkerPass(
  sql: Sql,
  deps: { chain?: ChainAdapter; deliver?: WebhookDeliver; fetch?: typeof fetch; name?: string } = {},
): Promise<WorkerPassResult> {
  const started = Date.now();
  const chain = deps.chain ?? getChain();
  const out: WorkerPassResult = { ok: true, indexer: null, expiry: null, pending: null, payouts: null, emails: null, ms: 0 };
  const step = async <K extends keyof Omit<WorkerPassResult, "ok" | "ms">>(k: K, fn: () => Promise<unknown>) => {
    try {
      (out as unknown as Record<string, unknown>)[k] = await fn();
    } catch (e) {
      out.ok = false;
      (out as unknown as Record<string, unknown>)[k] = errOf(e);
    }
  };
  const chainLive = isDeployed || Boolean(deps.chain);
  if (chainLive) await step("indexer", () => runIndexerPass(sql, chain, { force: Boolean(deps.chain) }));
  await step("expiry", () => expirySweep(sql));
  if (chainLive) await step("pending", () => pendingTxSweep(sql, chain));
  await step("payouts", () => advanceSandboxPayouts(sql, deps.deliver ?? httpDeliver(sql)));
  await step("emails", () => deliverEmails(sql, { fetch: deps.fetch }));
  if (++passes % 50 === 0) await pruneRateLimits(sql).catch(() => undefined);
  out.ms = Date.now() - started;
  await heartbeat(sql, deps.name ?? "worker", { ok: out.ok, ms: out.ms, deployed: isDeployed, intervalMs: env.workerIntervalMs() }).catch(() => undefined);
  return out;
}
