// Event ingest + indexer loop + reorg handling + reconciliation.
//
// `ingestLogs` is THE single code path that turns confirmed RemittanceManager logs into DB state. It is used by
// the worker's indexer AND by the receipt verifier behind /api/transfers/:id/{submitted,confirm} and
// /api/claims/:id/submitted, so the UI can update fast without a second, divergent implementation.
//
// Idempotency: blockchain_events is unique on (chain_id, tx, log_index). A log is applied only when its row is
// newly inserted, or when it was previously marked `removed` by a reorg and has now reappeared. Handlers are
// themselves state-setting (not incrementing), timeline rows are unique per (transfer, kind) and notifications are
// deduped, so even a forced re-apply converges.
//
// Authority: only logs whose address == contracts.manager are decoded (decodeLog). Events for unknown refs are
// stored but ignored. Funding events are cross-checked against the app row (sender, amount, recipient / claim
// signer, method); a mismatch is audited and the transfer is marked failed — never completed.

import type { Address, Hex } from "viem";
import { contracts, isDeployed, MEZO_TESTNET_ID, type ChainStatus } from "@/lib/chain/config";
import type { Sql } from "./db";
import { big, str } from "./db/rows";
import { argsToJson, decodeLog, isTransientError, MAX_LOG_RANGE, type ChainAdapter, type ChainTransfer, type DecodedLog } from "./chain";
import { audit } from "./audit";
import { clock } from "./clock";
import { env } from "./env";
import { notifyRecipientReceived, notifySender } from "./messages";
import { statusFromChain } from "./status";

const lc = (a: unknown) => String(a ?? "").toLowerCase();
const fromUnix = (sec: bigint | number): Date | null => (Number(sec) === 0 ? null : new Date(Number(sec) * 1000));

export type TimelineKind =
  | "created"
  | "funding_submitted"
  | "funded"
  | "delivered"
  | "link_shared"
  | "claim_submitted"
  | "claimed"
  | "expired"
  | "cancelled"
  | "refunded"
  | "failed"
  | "payout_requested"
  | "payout_processing"
  | "payout_completed"
  | "payout_failed";

/**
 * Timeline upsert. Chain-verified entries override app-recorded ones of the same kind; app entries never
 * overwrite chain entries; sandbox entries refresh (a new payout after a failed one).
 */
export async function addTimeline(
  tx: Sql,
  e: { transferId: string; kind: TimelineKind; source: "chain" | "app" | "sandbox"; txHash?: string | null; detail?: string | null; at?: Date },
): Promise<void> {
  const at = e.at ?? clock.now();
  const txh = e.txHash ? e.txHash.toLowerCase() : null;
  if (e.source === "chain") {
    await tx`INSERT INTO transfer_timeline (transfer_id, kind, source, tx_hash, detail, at)
             VALUES (${e.transferId}, ${e.kind}, 'chain', ${txh}, ${e.detail ?? null}, ${at})
             ON CONFLICT (transfer_id, kind) DO UPDATE SET source = 'chain', tx_hash = EXCLUDED.tx_hash, detail = EXCLUDED.detail, at = EXCLUDED.at
             WHERE transfer_timeline.source <> 'chain' OR transfer_timeline.tx_hash IS NULL`;
  } else if (e.source === "sandbox") {
    await tx`INSERT INTO transfer_timeline (transfer_id, kind, source, tx_hash, detail, at)
             VALUES (${e.transferId}, ${e.kind}, 'sandbox', NULL, ${e.detail ?? null}, ${at})
             ON CONFLICT (transfer_id, kind) DO UPDATE SET detail = EXCLUDED.detail, at = EXCLUDED.at`;
  } else {
    await tx`INSERT INTO transfer_timeline (transfer_id, kind, source, tx_hash, detail, at)
             VALUES (${e.transferId}, ${e.kind}, 'app', ${txh}, ${e.detail ?? null}, ${at})
             ON CONFLICT (transfer_id, kind) DO UPDATE SET tx_hash = EXCLUDED.tx_hash, detail = EXCLUDED.detail, at = EXCLUDED.at
             WHERE transfer_timeline.source = 'app'`;
  }
}

// ---------------------------------------------------------------- verification against the app row

interface TransferRow {
  id: string;
  ref: string;
  method: string;
  status: string;
  sender_address: string;
  recipient_wallet: string | null;
  claim_signer: string | null;
  amount: unknown;
  chain_transfer_id: unknown;
  chain_status: string | null;
  funding_tx_hash: string | null;
  claim_submitted_tx: string | null;
  funded_at: Date | null;
}

/** Fields where the on-chain record disagrees with what the sender created in the app. */
export function fundingMismatch(
  row: Pick<TransferRow, "method" | "sender_address" | "amount" | "recipient_wallet" | "claim_signer">,
  chainSide: { kind: "direct" | "claimable"; sender: string; amount: bigint; recipient?: string; claimSigner?: string },
): string[] {
  const out: string[] = [];
  if ((row.method === "direct") !== (chainSide.kind === "direct")) out.push("method");
  if (lc(row.sender_address) !== lc(chainSide.sender)) out.push("sender");
  if (big(row.amount) !== chainSide.amount) out.push("amount");
  if (row.method === "direct" && chainSide.kind === "direct" && lc(row.recipient_wallet) !== lc(chainSide.recipient)) out.push("recipient");
  if (row.method === "claim" && chainSide.kind === "claimable" && lc(row.claim_signer) !== lc(chainSide.claimSigner)) out.push("claimSigner");
  return out;
}

const MISMATCH_DETAIL = "On-chain funding did not match this transfer, so it was not marked complete";

async function isMismatched(tx: Sql, transferId: string): Promise<boolean> {
  const [r] = await tx`SELECT 1 FROM transfer_timeline WHERE transfer_id = ${transferId} AND kind = 'failed' AND source = 'chain'`;
  return Boolean(r);
}

const CHAIN_RANK: Record<string, number> = { funded: 1, claimed: 2, cancelled: 2, refunded: 2, completed: 2 };
const rank = (s: string | null | undefined) => (s ? (CHAIN_RANK[s] ?? 0) : 0);

// ---------------------------------------------------------------- event handlers

type Handler = (tx: Sql, log: DecodedLog, blockTime: Date) => Promise<void>;

async function onFunding(tx: Sql, log: DecodedLog, blockTime: Date, kind: "direct" | "claimable") {
  const a = log.args;
  const ref = lc(a.ref);
  // Refs are unique per sender on-chain, so anyone can emit an event carrying another user's ref from their own
  // address. Only the transfer's own sender can fund it: match on (ref, sender) and ignore everything else, so a
  // copied ref can neither fail nor complete someone else's transfer.
  const [t] = await tx<TransferRow>`SELECT * FROM transfers WHERE ref = ${ref} AND lower(sender_address) = ${lc(a.sender)} FOR UPDATE`;
  if (!t) {
    const [other] = await tx<{ id: string }>`SELECT id FROM transfers WHERE ref = ${ref}`;
    if (other) await audit(tx, "indexer", "foreign_ref_event", other.id, { sender: lc(a.sender), chainTransferId: String(a.transferId), txHash: log.txHash.toLowerCase() });
    return; // unknown ref (or another sender's copy of it): stored in blockchain_events, ignored
  }
  const chainId = a.transferId as bigint;
  if (t.chain_transfer_id !== null && big(t.chain_transfer_id) !== chainId) {
    await audit(tx, "indexer", "duplicate_ref_event", t.id, { known: str(t.chain_transfer_id), event: chainId.toString() });
    return;
  }
  const txh = log.txHash.toLowerCase();
  if (rank(t.chain_status) > rank(kind === "direct" ? "completed" : "funded")) {
    // Reconciliation already moved it past funding: only fill in the funding facts.
    await tx`UPDATE transfers SET funding_tx_hash = ${txh}, funded_at = ${blockTime}, updated_at = ${clock.now()} WHERE id = ${t.id}`;
    if (kind === "claimable") await addTimeline(tx, { transferId: t.id, kind: "funded", source: "chain", txHash: txh, at: blockTime });
    return;
  }
  // The id is unique on-chain; a stale row (orphaned by a reorg) may still hold it.
  await tx`UPDATE transfers SET chain_transfer_id = NULL WHERE chain_transfer_id = ${chainId} AND id <> ${t.id}`;
  const diffs = fundingMismatch(t, {
    kind,
    sender: lc(a.sender),
    amount: a.amount as bigint,
    recipient: kind === "direct" ? lc(a.recipient) : undefined,
    claimSigner: kind === "claimable" ? lc(a.claimSigner) : undefined,
  });
  const now = clock.now();
  const chainStatus: ChainStatus = kind === "direct" ? "completed" : "funded";
  const expiresAt = kind === "claimable" ? fromUnix(a.expiresAt as bigint) : null;
  if (diffs.length) {
    await tx`UPDATE transfers SET chain_transfer_id = ${chainId}, chain_status = ${chainStatus}, funding_tx_hash = ${txh}, funded_at = ${blockTime},
               status = 'failed', updated_at = ${now} WHERE id = ${t.id}`;
    await addTimeline(tx, { transferId: t.id, kind: "failed", source: "chain", txHash: txh, detail: `${MISMATCH_DETAIL} (${diffs.join(", ")})`, at: blockTime });
    await audit(tx, "indexer", "funding_mismatch", t.id, { fields: diffs, chainTransferId: chainId.toString(), txHash: txh });
    return;
  }
  if (kind === "direct") {
    await tx`UPDATE transfers SET chain_transfer_id = ${chainId}, chain_status = 'completed', status = 'completed', funding_tx_hash = ${txh},
               settlement_tx_hash = ${txh}, funded_at = ${blockTime}, settled_at = ${blockTime}, updated_at = ${now} WHERE id = ${t.id}`;
    await addTimeline(tx, { transferId: t.id, kind: "delivered", source: "chain", txHash: txh, at: blockTime });
    await notifySender(tx, t.id, "transfer_delivered");
    await notifyRecipientReceived(tx, t.id, lc(a.recipient));
  } else {
    await tx`UPDATE transfers SET chain_transfer_id = ${chainId}, chain_status = 'funded', funding_tx_hash = ${txh}, funded_at = ${blockTime},
               expires_at = ${expiresAt}, updated_at = ${now},
               status = CASE WHEN status IN ('awaiting_funding', 'funding_submitted', 'failed') THEN 'awaiting_claim' ELSE status END
             WHERE id = ${t.id}`;
    await addTimeline(tx, { transferId: t.id, kind: "funded", source: "chain", txHash: txh, at: blockTime });
    await notifySender(tx, t.id, "transfer_funded");
  }
}

async function transferByChainId(tx: Sql, id: unknown): Promise<TransferRow | null> {
  const [t] = await tx<TransferRow>`SELECT * FROM transfers WHERE chain_transfer_id = ${id as bigint} FOR UPDATE`;
  return t ?? null;
}

const handlers: Record<string, Handler> = {
  DirectTransferSent: (tx, log, time) => onFunding(tx, log, time, "direct"),
  ClaimableCreated: (tx, log, time) => onFunding(tx, log, time, "claimable"),

  async TransferClaimed(tx, log, time) {
    const t = await transferByChainId(tx, log.args.transferId);
    if (!t) return;
    const recipient = lc(log.args.recipient);
    const submitter = lc(log.args.submitter);
    const txh = log.txHash.toLowerCase();
    await tx`INSERT INTO claims (transfer_id, recipient_wallet, claim_transaction_hash, submitter, relayed, block_number, claimed_at)
             VALUES (${t.id}, ${recipient}, ${txh}, ${submitter}, ${submitter !== recipient}, ${log.blockNumber}, ${time})
             ON CONFLICT (transfer_id) DO UPDATE SET recipient_wallet = EXCLUDED.recipient_wallet, claim_transaction_hash = EXCLUDED.claim_transaction_hash,
               submitter = EXCLUDED.submitter, relayed = EXCLUDED.relayed, block_number = EXCLUDED.block_number, claimed_at = EXCLUDED.claimed_at`;
    const mismatched = await isMismatched(tx, t.id);
    await tx`UPDATE transfers SET chain_status = 'claimed', recipient_wallet = ${recipient}, settlement_tx_hash = ${txh}, settled_at = ${time},
               status = ${mismatched ? "failed" : "claimed"}, updated_at = ${clock.now()} WHERE id = ${t.id}`;
    await tx`UPDATE relay_attempts SET status = 'confirmed' WHERE tx_hash = ${txh}`;
    await addTimeline(tx, { transferId: t.id, kind: "claimed", source: "chain", txHash: txh, at: time });
    if (!mismatched) {
      await notifySender(tx, t.id, "transfer_claimed");
      await notifyRecipientReceived(tx, t.id, recipient);
    }
  },

  async TransferCancelled(tx, log, time) {
    const t = await transferByChainId(tx, log.args.transferId);
    if (!t) return;
    const txh = log.txHash.toLowerCase();
    const mismatched = await isMismatched(tx, t.id);
    await tx`UPDATE transfers SET chain_status = 'cancelled', settlement_tx_hash = ${txh}, settled_at = ${time},
               status = ${mismatched ? "failed" : "cancelled"}, updated_at = ${clock.now()} WHERE id = ${t.id}`;
    await addTimeline(tx, { transferId: t.id, kind: "cancelled", source: "chain", txHash: txh, at: time });
    if (!mismatched) await notifySender(tx, t.id, "transfer_cancelled");
  },

  async TransferRefunded(tx, log, time) {
    const t = await transferByChainId(tx, log.args.transferId);
    if (!t) return;
    const txh = log.txHash.toLowerCase();
    const mismatched = await isMismatched(tx, t.id);
    await tx`UPDATE transfers SET chain_status = 'refunded', settlement_tx_hash = ${txh}, settled_at = ${time},
               status = ${mismatched ? "failed" : "refunded"}, updated_at = ${clock.now()} WHERE id = ${t.id}`;
    await addTimeline(tx, { transferId: t.id, kind: "refunded", source: "chain", txHash: txh, at: time });
    if (!mismatched) await notifySender(tx, t.id, "transfer_refunded");
  },
};

// ---------------------------------------------------------------- ingest

/** Apply one confirmed log in its own DB transaction. Returns false when it had already been applied. */
export async function ingestEvent(sql: Sql, log: DecodedLog, blockTime: Date): Promise<boolean> {
  return sql.begin(async (tx) => {
    const args = argsToJson(log.args);
    const chainTransferId = (log.args.transferId as bigint | undefined) ?? 0n;
    const ins = await tx<{ id: string }>`
      INSERT INTO blockchain_events (chain_id, transaction_hash, log_index, block_number, block_hash, event_name, chain_transfer_id, args, removed, processed_at)
      VALUES (${MEZO_TESTNET_ID}, ${log.txHash.toLowerCase()}, ${log.logIndex}, ${log.blockNumber}, ${log.blockHash.toLowerCase()}, ${log.eventName},
              ${chainTransferId}, ${args}::jsonb, FALSE, ${clock.now()})
      ON CONFLICT (chain_id, transaction_hash, log_index) DO UPDATE SET removed = FALSE, block_number = EXCLUDED.block_number,
        block_hash = EXCLUDED.block_hash, processed_at = EXCLUDED.processed_at
      WHERE blockchain_events.removed = TRUE
      RETURNING id`;
    if (ins.length === 0) return false;
    const h = handlers[log.eventName];
    if (h) await h(tx, log, blockTime);
    return true;
  });
}

async function rememberBlock(sql: Sql, n: bigint, hash: string) {
  await sql`INSERT INTO indexer_blocks (block_number, block_hash) VALUES (${n}, ${hash.toLowerCase()})
            ON CONFLICT (block_number) DO UPDATE SET block_hash = EXCLUDED.block_hash`;
}

/** Apply many logs in (block, logIndex) order. Returns how many were newly applied. */
export async function ingestLogs(sql: Sql, chain: ChainAdapter, logs: DecodedLog[]): Promise<number> {
  const sorted = [...logs].sort((x, y) => (x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1));
  const times = new Map<bigint, Date>();
  let applied = 0;
  for (const l of sorted) {
    let t = times.get(l.blockNumber);
    if (!t) {
      const b = await chain.getBlock(l.blockNumber); // throws on RPC failure → caller retries; never guess a time
      t = new Date(Number(b.timestamp) * 1000);
      times.set(l.blockNumber, t);
    }
    try {
      if (await ingestEvent(sql, l, t)) applied++;
    } catch (e) {
      if (isTransientError(e)) throw e;
      // Poison event (bad data / handler bug): audit it and keep indexing. Reconciliation re-reads chain state.
      const message = ((e as Error)?.message ?? String(e)).slice(0, 300);
      console.error("[indexer] event failed", l.eventName, l.txHash, l.logIndex, message);
      await audit(sql, "worker", "event_failed", `${l.txHash}:${l.logIndex}`, { event: l.eventName, error: message });
    }
  }
  // Remember the hashes of blocks we applied logs from (incl. receipt-verifier logs ahead of the cursor) so a
  // reorg of those blocks is detected too.
  const seen = new Map<bigint, string>();
  for (const l of sorted) seen.set(l.blockNumber, l.blockHash);
  for (const [n, h] of seen) await rememberBlock(sql, n, h);
  return applied;
}

// ---------------------------------------------------------------- chain → DB re-derivation (reorg + reconcile)

/**
 * Re-derive a transfer's [chain] columns from the contract (transferIdByRef + getTransfer). Corrects drift and
 * audits every difference. Returns the list of fields that differed.
 */
export async function syncTransferFromChain(sql: Sql, chain: ChainAdapter, transferId: string, actor: "reconcile" | "reorg"): Promise<string[]> {
  const [pre] = await sql<TransferRow>`SELECT * FROM transfers WHERE id = ${transferId}`;
  if (!pre) return [];
  const chainId = await chain.transferIdByRef(pre.sender_address as Address, pre.ref as Hex);
  const ct: ChainTransfer | null = chainId === 0n ? null : await chain.getTransfer(chainId);
  return sql.begin(async (tx) => {
    const [t] = await tx<TransferRow & Record<string, unknown>>`SELECT * FROM transfers WHERE id = ${transferId} FOR UPDATE`;
    if (!t) return [];
    const now = clock.now();
    if (!ct || ct.status === "none" || lc(ct.ref) !== lc(t.ref)) {
      if (t.chain_transfer_id === null && t.chain_status === null) return [];
      // The chain no longer has this transfer (orphaned by a reorg): back to the pre-chain state.
      await tx`DELETE FROM claims WHERE transfer_id = ${t.id}`;
      await tx`UPDATE transfers SET chain_transfer_id = NULL, chain_status = NULL, funded_at = NULL, settled_at = NULL, settlement_tx_hash = NULL,
                 recipient_wallet = CASE WHEN method = 'claim' THEN NULL ELSE recipient_wallet END,
                 status = CASE WHEN funding_tx_hash IS NOT NULL THEN 'funding_submitted' ELSE 'awaiting_funding' END,
                 funding_submitted_at = CASE WHEN funding_tx_hash IS NOT NULL THEN ${now}::timestamptz ELSE funding_submitted_at END,
                 updated_at = ${now} WHERE id = ${t.id}`;
      await audit(tx, actor, "chain_drift", t.id, { fields: ["chain_transfer_id", "chain_status"], chain: "missing", db: t.chain_status });
      return ["chain_transfer_id", "chain_status"];
    }
    const diffs = fundingMismatch(t, {
      kind: ct.kind === "direct" ? "direct" : "claimable",
      sender: ct.sender,
      amount: ct.amount,
      recipient: ct.recipient,
      claimSigner: ct.claimSigner,
    });
    const terminal = ct.status !== "funded";
    let status = statusFromChain(ct.status) ?? t.status;
    if (ct.status === "funded" && t.status === "claim_submitted") status = "claim_submitted"; // claim tx still pending
    if (diffs.length) status = "failed";
    const expected = {
      chain_transfer_id: chainId.toString(),
      chain_status: ct.status,
      status,
      recipient_wallet: ct.status === "claimed" || ct.kind === "direct" ? lc(ct.recipient) : t.method === "claim" ? null : t.recipient_wallet ? lc(t.recipient_wallet) : null,
    };
    const actual = {
      chain_transfer_id: t.chain_transfer_id === null ? null : str(t.chain_transfer_id),
      chain_status: t.chain_status,
      status: t.status,
      recipient_wallet: t.recipient_wallet ? lc(t.recipient_wallet) : null,
    };
    const changed = (Object.keys(expected) as (keyof typeof expected)[]).filter((k) => expected[k] !== actual[k]);
    if (changed.length === 0) return [];
    await tx`UPDATE transfers SET chain_transfer_id = NULL WHERE chain_transfer_id = ${chainId} AND id <> ${t.id}`;
    await tx`UPDATE transfers SET chain_transfer_id = ${chainId}, chain_status = ${ct.status}, status = ${status},
               recipient_wallet = ${expected.recipient_wallet},
               expires_at = ${ct.kind === "claimable" ? fromUnix(ct.expiresAt) : t.expires_at ? new Date(t.expires_at as string) : null},
               funded_at = COALESCE(funded_at, ${fromUnix(ct.createdAt)}::timestamptz),
               settled_at = ${terminal ? fromUnix(ct.settledAt) : null}, updated_at = ${now}
             WHERE id = ${t.id}`;
    await audit(tx, actor, "chain_drift", t.id, {
      chainTransferId: chainId.toString(),
      fields: Object.fromEntries(changed.map((k) => [k, { db: actual[k], chain: expected[k] }])),
    });
    if (diffs.length) {
      await addTimeline(tx, { transferId: t.id, kind: "failed", source: "chain", detail: `${MISMATCH_DETAIL} (${diffs.join(", ")})` });
      return changed;
    }
    const detail = "Reconciled from on-chain state";
    const settled = fromUnix(ct.settledAt) ?? now;
    if (ct.status === "funded") {
      await addTimeline(tx, { transferId: t.id, kind: "funded", source: "chain", detail, at: fromUnix(ct.createdAt) ?? now });
      await notifySender(tx, t.id, "transfer_funded");
    } else if (ct.status === "completed") {
      await addTimeline(tx, { transferId: t.id, kind: "delivered", source: "chain", detail, at: settled });
      await notifySender(tx, t.id, "transfer_delivered");
      await notifyRecipientReceived(tx, t.id, lc(ct.recipient));
    } else if (ct.status === "claimed") {
      await addTimeline(tx, { transferId: t.id, kind: "claimed", source: "chain", detail, at: settled });
      await notifySender(tx, t.id, "transfer_claimed");
      await notifyRecipientReceived(tx, t.id, lc(ct.recipient));
    } else if (ct.status === "cancelled" || ct.status === "refunded") {
      await addTimeline(tx, { transferId: t.id, kind: ct.status, source: "chain", detail, at: settled });
      await notifySender(tx, t.id, ct.status === "cancelled" ? "transfer_cancelled" : "transfer_refunded");
    }
    return changed;
  });
}

/** Re-read chain state for transfers in non-terminal chain states (and pending hints). */
export async function reconcileTransfers(sql: Sql, chain: ChainAdapter, limit = 200): Promise<{ checked: number; drifted: number }> {
  const rows = await sql<{ id: string }>`
    SELECT id FROM transfers
    WHERE chain_status = 'funded' OR (chain_status IS NULL AND status IN ('funding_submitted', 'claim_submitted'))
    ORDER BY updated_at ASC LIMIT ${limit}`;
  let drifted = 0;
  for (const r of rows) {
    try {
      if ((await syncTransferFromChain(sql, chain, r.id, "reconcile")).length) drifted++;
    } catch (e) {
      if (isTransientError(e)) throw e;
      console.warn("[reconcile]", r.id, (e as Error).message);
    }
  }
  return { checked: rows.length, drifted };
}

// ---------------------------------------------------------------- cursor + reorg

const CURSOR = "main";

export async function getCursor(sql: Sql): Promise<{ block: bigint; hash: string | null }> {
  const [row] = await sql<{ last_block: unknown; last_block_hash: string | null }>`SELECT last_block, last_block_hash FROM indexer_cursor WHERE name = ${CURSOR}`;
  if (row) return { block: big(row.last_block), hash: row.last_block_hash };
  const start = contracts.deployBlock > 0n ? contracts.deployBlock - 1n : 0n;
  await sql`INSERT INTO indexer_cursor (name, last_block, last_block_hash, updated_at) VALUES (${CURSOR}, ${start}, NULL, ${clock.now()})
            ON CONFLICT (name) DO NOTHING`;
  return { block: start, hash: null };
}

async function setCursor(sql: Sql, block: bigint, hash: string | null) {
  await sql`UPDATE indexer_cursor SET last_block = ${block}, last_block_hash = ${hash ? hash.toLowerCase() : null}, updated_at = ${clock.now()} WHERE name = ${CURSOR}`;
}

/**
 * Reorg check: compare the stored hash of the cursor block (and of recently applied blocks, which may be ahead of
 * the cursor via the receipt verifier) with the chain. On mismatch, rewind REORG_WINDOW blocks: events in the
 * window are marked removed, chain-derived rows from their txs are dropped, and affected transfers are
 * re-derived from getTransfer. The rewound range is then re-indexed. Returns the first rewound block, or null.
 */
export async function checkReorg(sql: Sql, chain: ChainAdapter): Promise<bigint | null> {
  const cursor = await getCursor(sql);
  const window = BigInt(env.reorgWindow());
  let forkAt: bigint | null = null;
  if (cursor.hash) {
    const live = await chain.getBlock(cursor.block);
    if (lc(live.hash) !== lc(cursor.hash)) forkAt = cursor.block - window + 1n;
  }
  const recent = await sql<{ block_number: unknown; block_hash: string }>`
    SELECT block_number, block_hash FROM indexer_blocks WHERE block_number > ${cursor.block - window} ORDER BY block_number ASC`;
  for (const b of recent) {
    const n = big(b.block_number);
    if (forkAt !== null && n >= forkAt) break;
    const live = await chain.getBlock(n);
    if (lc(live.hash) !== lc(b.block_hash)) {
      forkAt = n;
      break;
    }
  }
  if (forkAt === null) return null;
  const floor = contracts.deployBlock > 0n ? contracts.deployBlock : 0n;
  if (forkAt < floor) forkAt = floor;
  await rewindFrom(sql, chain, forkAt);
  return forkAt;
}

export async function rewindFrom(sql: Sql, chain: ChainAdapter, block: bigint): Promise<string[]> {
  const affectedIds = await sql.begin(async (tx) => {
    const removed = await tx<{ transaction_hash: string; chain_transfer_id: unknown }>`
      UPDATE blockchain_events SET removed = TRUE WHERE block_number >= ${block} AND removed = FALSE
      RETURNING transaction_hash, chain_transfer_id`;
    const hashes = Array.from(new Set(removed.map((r) => r.transaction_hash)));
    const chainIds = Array.from(new Set(removed.map((r) => str(r.chain_transfer_id))));
    let ids: string[] = [];
    if (hashes.length) {
      const list = tx.join(hashes.map((h) => tx.frag`${h}`), ", ");
      const byTx = await tx<{ transfer_id: string }>`SELECT DISTINCT transfer_id FROM transfer_timeline WHERE source = 'chain' AND tx_hash IN (${list})`;
      const byChain = chainIds.length
        ? await tx<{ id: string }>`SELECT id FROM transfers WHERE chain_transfer_id IN (${tx.join(chainIds.map((c) => tx.frag`${c}::numeric`), ", ")})`
        : [];
      ids = Array.from(new Set([...byTx.map((r) => r.transfer_id), ...byChain.map((r) => r.id)]));
      await tx`DELETE FROM transfer_timeline WHERE source = 'chain' AND tx_hash IN (${list})`;
      await tx`DELETE FROM claims WHERE claim_transaction_hash IN (${list})`;
    }
    await tx`DELETE FROM indexer_blocks WHERE block_number >= ${block}`;
    await tx`UPDATE indexer_cursor SET last_block = LEAST(last_block, ${block - 1n}), last_block_hash = NULL, updated_at = ${clock.now()} WHERE name = ${CURSOR}`;
    await audit(tx, "worker", "reorg_rewind", block.toString(), { txs: hashes.length, transfers: ids.length });
    return ids;
  });
  for (const id of affectedIds) await syncTransferFromChain(sql, chain, id, "reorg");
  return affectedIds;
}

// ---------------------------------------------------------------- pass

export interface IndexerPassResult {
  from: string | null;
  to: string | null;
  head: string | null;
  logs: number;
  applied: number;
  rewoundTo: string | null;
  reconciled: { checked: number; drifted: number } | null;
}

let passCount = 0;

export async function runIndexerPass(
  sql: Sql,
  chain: ChainAdapter,
  opts: { confirmations?: number; maxBlocks?: bigint; reconcile?: boolean; force?: boolean } = {},
): Promise<IndexerPassResult> {
  const result: IndexerPassResult = { from: null, to: null, head: null, logs: 0, applied: 0, rewoundTo: null, reconciled: null };
  if (!isDeployed && !opts.force) return result;
  const confirmations = BigInt(opts.confirmations ?? env.confirmations());
  const head = await chain.getBlockNumber();
  result.head = head.toString();
  const rewound = await checkReorg(sql, chain);
  if (rewound !== null) result.rewoundTo = rewound.toString();
  let { block: cursor } = await getCursor(sql);
  const target = head - confirmations;
  const maxBlocks = opts.maxBlocks ?? 20_000n; // per pass, so a long catch-up doesn't starve the other jobs
  const end = target < cursor + maxBlocks ? target : cursor + maxBlocks;
  if (end > cursor) result.from = (cursor + 1n).toString();
  while (cursor < end) {
    const from = cursor + 1n;
    const to = from + MAX_LOG_RANGE - 1n < end ? from + MAX_LOG_RANGE - 1n : end;
    const raw = await chain.getLogs({ fromBlock: from, toBlock: to });
    const decoded = raw.map(decodeLog).filter((l): l is DecodedLog => l !== null);
    result.logs += decoded.length;
    result.applied += await ingestLogs(sql, chain, decoded);
    const tip = await chain.getBlock(to);
    await rememberBlock(sql, to, tip.hash);
    await setCursor(sql, to, tip.hash);
    cursor = to;
  }
  result.to = cursor.toString();
  await sql`DELETE FROM indexer_blocks WHERE block_number < ${cursor - 200n}`;
  passCount++;
  if (opts.reconcile || (passCount - 1) % env.reconcileEvery() === 0) result.reconciled = await reconcileTransfers(sql, chain);
  return result;
}

export async function indexerStatus(sql: Sql): Promise<{ lastBlock: bigint | null; updatedAt: Date | null }> {
  const [row] = await sql<{ last_block: unknown; updated_at: Date }>`SELECT last_block, updated_at FROM indexer_cursor WHERE name = ${CURSOR}`;
  return row ? { lastBlock: big(row.last_block), updatedAt: new Date(row.updated_at) } : { lastBlock: null, updatedAt: null };
}
