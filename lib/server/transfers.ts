// Remittance engine: create (idempotent), hints (submitted / shared), receipt confirm, detail + list with a
// caller perspective, and the shared serializer.
//
// Visibility: senders see their own transfers. A recipient sees a transfer once MUSD is verifiably theirs:
// direct with chain_status completed to their wallet, or a claim they claimed (recipient_wallet set from
// TransferClaimed). Recipients never see the sender's recipient-book data or quote.

import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import { z } from "zod";
import type { PayoutRequest, TimelineEntry, Transfer } from "@/lib/api-types";
import { transferRef } from "@/lib/chain/claim";
import { MANAGER_LIMITS } from "@/lib/chain/config";
import type { Sql } from "./db";
import { iso, isoOrNull, strOrNull } from "./db/rows";
import { isTransientError, type ChainAdapter } from "./chain";
import type { Session } from "./auth";
import { audit } from "./audit";
import { clock } from "./clock";
import { confirmTransferTx, type ConfirmState } from "./confirm";
import { HttpError, notFound, unavailable } from "./errors";
import { addTimeline } from "./indexer";
import { trimDecimal } from "./money";
import { serializePayout } from "./payouts";
import { assertUsableQuote, loadQuote, parseAmount, resolveCountry } from "./quotes";
import { projectStatus } from "./status";

const zAddr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");
const zId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a uuid");

export const zCreateTransfer = z.object({
  method: z.enum(["direct", "claim"]),
  amount: z.string().max(80),
  destinationCountry: z.string().trim().length(2),
  recipientId: zId.nullish(),
  recipientWallet: zAddr.nullish(),
  claimSigner: zAddr.nullish(),
  expiresAt: z.number().int().nullish(),
  quoteId: zId.nullish(),
  note: z.string().max(280).nullish(),
  showSenderName: z.boolean().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});
export type CreateTransferInput = z.infer<typeof zCreateTransfer>;

// ---------------------------------------------------------------- loading + serialization

type Row = Record<string, unknown>;
export type Perspective = { userId: string; address: string } | "public";

const SELECT = `
  SELECT t.*, r.display_name AS recipient_name, u.display_name AS sender_name, c.recipient_wallet AS claimed_by
  FROM transfers t
  LEFT JOIN recipients r ON r.id = t.recipient_id
  JOIN users u ON u.id = t.sender_user_id
  LEFT JOIN claims c ON c.transfer_id = t.id`;

export async function loadTransferRow(sql: Sql, id: string): Promise<Row | null> {
  const [row] = await sql<Row>`${sql.raw(SELECT)} WHERE t.id = ${id}`;
  return row ?? null;
}

export function roleOf(row: Row, who: Perspective): Transfer["role"] | null {
  if (who === "public") return "public";
  if (String(row.sender_user_id) === who.userId) return "sender";
  const wallet = strOrNull(row.recipient_wallet);
  if (wallet && wallet === who.address.toLowerCase()) {
    if (row.method === "direct" && row.chain_status === "completed") return "recipient";
    if (row.method === "claim" && (row.chain_status === "claimed" || row.claimed_by)) return "recipient";
  }
  return null;
}

async function timelines(sql: Sql, ids: string[]): Promise<Map<string, TimelineEntry[]>> {
  const out = new Map<string, TimelineEntry[]>();
  if (!ids.length) return out;
  const rows = await sql<Row>`SELECT transfer_id, kind, source, tx_hash, detail, at FROM transfer_timeline
    WHERE transfer_id IN (${sql.join(ids.map((i) => sql.frag`${i}::uuid`), ", ")}) ORDER BY at ASC, id ASC`;
  for (const r of rows) {
    const k = String(r.transfer_id);
    const e: TimelineEntry = {
      kind: r.kind as TimelineEntry["kind"],
      at: iso(r.at),
      txHash: strOrNull(r.tx_hash),
      source: r.source as TimelineEntry["source"],
      ...(r.detail ? { detail: String(r.detail) } : {}),
    };
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(e);
  }
  return out;
}

async function payoutsFor(sql: Sql, ids: string[], userId: string): Promise<Map<string, PayoutRequest>> {
  const out = new Map<string, PayoutRequest>();
  if (!ids.length) return out;
  const rows = await sql<Row>`SELECT * FROM payout_requests WHERE user_id = ${userId}
    AND transfer_id IN (${sql.join(ids.map((i) => sql.frag`${i}::uuid`), ", ")}) ORDER BY created_at ASC`;
  for (const r of rows) out.set(String(r.transfer_id), serializePayout(r)); // latest wins
  return out;
}

export async function serializeTransfers(sql: Sql, rows: Row[], who: Perspective): Promise<Transfer[]> {
  const ids = rows.map((r) => String(r.id));
  const tl = await timelines(sql, ids);
  const payouts = who === "public" ? new Map<string, PayoutRequest>() : await payoutsFor(sql, ids, who.userId);
  const now = clock.now();
  const out: Transfer[] = [];
  for (const r of rows) {
    const role = roleOf(r, who) ?? "public";
    const id = String(r.id);
    const isSender = role === "sender";
    let timeline = tl.get(id) ?? [];
    if (!isSender && role !== "recipient") timeline = timeline.filter((e) => !e.kind.startsWith("payout_") && e.kind !== "link_shared");
    if (isSender) timeline = timeline.filter((e) => !e.kind.startsWith("payout_")); // the recipient's off-ramp is theirs
    const wallet = strOrNull(r.recipient_wallet);
    out.push({
      id,
      ref: String(r.ref),
      chainTransferId: r.chain_transfer_id === null || r.chain_transfer_id === undefined ? null : trimDecimal(r.chain_transfer_id),
      method: r.method as Transfer["method"],
      status: projectStatus(r as never, now),
      role,
      senderAddress: String(r.sender_address),
      senderDisplayName: r.show_sender_name && r.sender_name ? String(r.sender_name) : null,
      recipient: isSender
        ? r.recipient_id || wallet
          ? { id: strOrNull(r.recipient_id), displayName: strOrNull(r.recipient_name), walletAddress: wallet }
          : null
        : wallet
          ? { id: null, displayName: null, walletAddress: wallet }
          : null,
      claimSigner: strOrNull(r.claim_signer),
      destinationCountry: String(r.destination_country),
      amount: trimDecimal(r.amount),
      fee: trimDecimal(r.fee),
      quote: isSender ? await loadQuote(sql, strOrNull(r.quote_id)) : null,
      note: isSender || role === "recipient" ? strOrNull(r.note) : null,
      expiresAt: isoOrNull(r.expires_at),
      fundingTxHash: strOrNull(r.funding_tx_hash),
      settlementTxHash: strOrNull(r.settlement_tx_hash),
      createdAt: iso(r.created_at),
      fundedAt: isoOrNull(r.funded_at),
      settledAt: isoOrNull(r.settled_at),
      timeline,
      payout: role === "recipient" ? (payouts.get(id) ?? null) : null,
    });
  }
  return out;
}

/** Detail with access control: sender, or verified recipient. Everyone else gets 404. */
export async function getTransferFor(sql: Sql, session: Session, id: string): Promise<Transfer> {
  const row = await loadTransferRow(sql, id);
  const who = { userId: session.userId, address: session.address };
  if (!row || !roleOf(row, who)) throw notFound("Transfer not found");
  return (await serializeTransfers(sql, [row], who))[0];
}

export async function listTransfers(
  sql: Sql,
  session: Session,
  opts: { role?: "all" | "sent" | "received"; cursor?: string | null; limit?: number },
): Promise<{ transfers: Transfer[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const addr = session.address.toLowerCase();
  const sent = sql.frag`t.sender_user_id = ${session.userId}`;
  const received = sql.frag`(t.recipient_wallet = ${addr} AND t.sender_user_id <> ${session.userId} AND
    ((t.method = 'direct' AND t.chain_status = 'completed') OR (t.method = 'claim' AND (t.chain_status = 'claimed' OR c.transfer_id IS NOT NULL))))`;
  const who = opts.role === "sent" ? sent : opts.role === "received" ? received : sql.frag`(${sent} OR ${received})`;
  let after = sql.frag`TRUE`;
  if (opts.cursor) {
    try {
      const [at, id] = Buffer.from(opts.cursor, "base64url").toString("utf8").split("|");
      if (!at || !/^[0-9a-f-]{36}$/i.test(id ?? "") || Number.isNaN(new Date(at).getTime())) throw new Error("bad");
      after = sql.frag`(t.created_at, t.id) < (${new Date(at)}::timestamptz, ${id}::uuid)`;
    } catch {
      throw new HttpError(400, "invalid_cursor", "Invalid cursor");
    }
  }
  const rows = await sql<Row>`${sql.raw(SELECT)} WHERE ${who} AND ${after} ORDER BY t.created_at DESC, t.id DESC LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit && last ? Buffer.from(`${iso(last.created_at)}|${String(last.id)}`).toString("base64url") : null;
  return { transfers: await serializeTransfers(sql, page, { userId: session.userId, address: session.address }), nextCursor };
}

// ---------------------------------------------------------------- create

export async function createTransfer(sql: Sql, session: Session, raw: unknown): Promise<Transfer> {
  const input = zCreateTransfer.parse(raw);
  const who = { userId: session.userId, address: session.address };
  const existing = await sql<{ id: string }>`SELECT id FROM transfers WHERE sender_user_id = ${session.userId} AND idempotency_key = ${input.idempotencyKey}`;
  if (existing.length) return (await serializeTransfers(sql, [(await loadTransferRow(sql, existing[0].id))!], who))[0];

  const amount = parseAmount(input.amount);
  const country = resolveCountry(input.destinationCountry);
  const sender = session.address.toLowerCase();

  let recipient: Row | null = null;
  if (input.recipientId) {
    const [r] = await sql<Row>`SELECT * FROM recipients WHERE id = ${input.recipientId} AND user_id = ${session.userId} AND deleted_at IS NULL`;
    if (!r) throw notFound("Recipient not found");
    recipient = r;
  }

  let recipientWallet: string | null = null;
  let claimSigner: string | null = null;
  let expiresAt: Date | null = null;
  if (input.method === "direct") {
    if (input.claimSigner || input.expiresAt) throw new HttpError(400, "invalid_request", "claimSigner and expiresAt are only for claim-link transfers");
    recipientWallet = (input.recipientWallet ?? strOrNull(recipient?.wallet_address))?.toLowerCase() ?? null;
    if (!recipientWallet) throw new HttpError(400, "recipient_wallet_required", "A direct transfer needs the recipient's Mezo wallet address");
    if (/^0x0{40}$/.test(recipientWallet)) throw new HttpError(400, "invalid_address", "Invalid recipient wallet");
    if (recipientWallet === sender) throw new HttpError(400, "self_transfer", "You can't send to your own wallet");
  } else {
    if (input.recipientWallet) throw new HttpError(400, "invalid_request", "Claim-link transfers don't take a recipient wallet; the recipient picks it when claiming");
    if (!input.claimSigner || /^0x0{40}$/i.test(input.claimSigner)) throw new HttpError(400, "claim_signer_required", "claimSigner is required for claim-link transfers");
    claimSigner = input.claimSigner.toLowerCase();
    if (claimSigner === sender) throw new HttpError(400, "invalid_claim_signer", "The claim key must be a fresh key, not your wallet");
    const nowSec = Math.floor(clock.now().getTime() / 1000);
    const exp = input.expiresAt ?? 0;
    if (exp < nowSec + MANAGER_LIMITS.TESTNET_MIN_EXPIRY || exp > nowSec + MANAGER_LIMITS.MAX_EXPIRY) {
      throw new HttpError(400, "invalid_expiry", "expiresAt must be between 60 seconds and 90 days from now");
    }
    expiresAt = new Date(exp * 1000);
  }

  if (input.quoteId) await assertUsableQuote(sql, session.userId, input.quoteId, amount, country.code);
  const note = input.note?.trim() ? input.note.trim() : null;

  // The id must exist before the ref (ref = transferRef(id)), so generate it here and insert it explicitly.
  const id = randomUUID();
  const ref = transferRef(id).toLowerCase();
  const now = clock.now();
  const inserted = await sql.begin(async (tx) => {
    const rows = await tx<{ id: string }>`
      INSERT INTO transfers (id, ref, idempotency_key, sender_user_id, sender_address, recipient_id, method, recipient_wallet, claim_signer,
        destination_country, amount, fee, quote_id, note, show_sender_name, expires_at, status, created_at, updated_at)
      VALUES (${id}, ${ref}, ${input.idempotencyKey}, ${session.userId}, ${sender}, ${input.recipientId ?? null}, ${input.method}, ${recipientWallet},
        ${claimSigner}, ${country.code}, ${amount}::numeric, 0, ${input.quoteId ?? null}, ${note}, ${Boolean(input.showSenderName)}, ${expiresAt},
        'awaiting_funding', ${now}, ${now})
      ON CONFLICT (sender_user_id, idempotency_key) DO NOTHING
      RETURNING id`;
    if (!rows.length) return null;
    await addTimeline(tx, { transferId: id, kind: "created", source: "app", at: now });
    await audit(tx, `user:${session.userId}`, "transfer_created", id, { method: input.method, country: country.code, amount: amount.toString() });
    return id;
  });
  const finalId = inserted ?? (await sql<{ id: string }>`SELECT id FROM transfers WHERE sender_user_id = ${session.userId} AND idempotency_key = ${input.idempotencyKey}`)[0]?.id;
  return (await serializeTransfers(sql, [(await loadTransferRow(sql, finalId))!], who))[0];
}

// ---------------------------------------------------------------- hints + confirm

async function ownSenderRow(sql: Sql, session: Session, id: string): Promise<Row> {
  const row = await loadTransferRow(sql, id);
  if (!row || String(row.sender_user_id) !== session.userId) throw notFound("Transfer not found");
  return row;
}

/** Funding tx hint → funding_submitted (never settlement truth), then a fast confirm attempt. */
export async function reportFunding(sql: Sql, chain: ChainAdapter, session: Session, id: string, txHash: Hex): Promise<Transfer> {
  await ownSenderRow(sql, session, id);
  const h = txHash.toLowerCase();
  await sql.begin(async (tx) => {
    const rows = await tx`UPDATE transfers SET funding_tx_hash = ${h}, funding_submitted_at = ${clock.now()}, status = 'funding_submitted', updated_at = ${clock.now()}
      WHERE id = ${id} AND chain_status IS NULL AND status IN ('awaiting_funding', 'funding_submitted', 'failed') RETURNING id`;
    if (rows.length) await addTimeline(tx, { transferId: id, kind: "funding_submitted", source: "app", txHash: h });
  });
  try {
    await confirmTransferTx(sql, chain, id, h as Hex, "funding");
  } catch (e) {
    if (!isTransientError(e)) console.warn("[transfers] fast confirm failed", (e as Error).message);
  }
  return getTransferFor(sql, session, id);
}

/** Re-verify the transfer's pending tx hints now. Sender or verified recipient. */
export async function confirmTransfer(sql: Sql, chain: ChainAdapter, session: Session, id: string): Promise<{ transfer: Transfer; result: ConfirmState | "nothing_to_confirm" }> {
  const t = await getTransferFor(sql, session, id); // access check
  const row = (await loadTransferRow(sql, id))!;
  let result: ConfirmState | "nothing_to_confirm" = "nothing_to_confirm";
  try {
    if (row.chain_status === null && row.funding_tx_hash) result = await confirmTransferTx(sql, chain, id, String(row.funding_tx_hash) as Hex, "funding");
    else if (row.status === "claim_submitted" && row.claim_submitted_tx)
      result = await confirmTransferTx(sql, chain, id, String(row.claim_submitted_tx) as Hex, "claim");
  } catch (e) {
    if (isTransientError(e)) throw unavailable("chain_unavailable", "Mezo RPC is unreachable right now. Try again shortly.");
    throw e;
  }
  return { transfer: result === "nothing_to_confirm" ? t : await getTransferFor(sql, session, id), result };
}

export async function markShared(sql: Sql, session: Session, id: string, channel: "copy" | "share_sheet" | "qr"): Promise<Transfer> {
  const row = await ownSenderRow(sql, session, id);
  if (row.method !== "claim") throw new HttpError(400, "not_claim", "Only claim-link transfers have a link to share");
  const labels = { copy: "Link copied", share_sheet: "Shared via the share sheet", qr: "Shown as a QR code" } as const;
  await addTimeline(sql, { transferId: id, kind: "link_shared", source: "app", detail: labels[channel] });
  return getTransferFor(sql, session, id);
}

