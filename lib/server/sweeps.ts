// Periodic sweeps run by the worker after each indexer pass.
//  - expiry: funded claim transfers past expires_at → timeline "expired" + sender notification (once).
//  - pending hints: funding/claim tx hints are re-checked by receipt; a reverted funding receipt, or no confirmed
//    funding event FUNDING_TIMEOUT_SECONDS (30 min) after the hint → failed. A reverted claim → awaiting_claim.
//  - relay attempts: submitted relayer txs → confirmed / reverted.

import type { Hex } from "viem";
import type { Sql } from "./db";
import { date } from "./db/rows";
import { isTransientError, type ChainAdapter } from "./chain";
import { audit } from "./audit";
import { addSeconds, clock } from "./clock";
import { confirmTransferTx } from "./confirm";
import { env } from "./env";
import { addTimeline } from "./indexer";
import { notifySender } from "./messages";

export async function expirySweep(sql: Sql): Promise<number> {
  const now = clock.now();
  const rows = await sql<{ id: string }>`
    SELECT t.id FROM transfers t
    WHERE t.method = 'claim' AND t.chain_status = 'funded' AND t.expires_at <= ${now}
      AND NOT EXISTS (SELECT 1 FROM transfer_timeline tl WHERE tl.transfer_id = t.id AND tl.kind = 'expired')
    LIMIT 200`;
  for (const r of rows) {
    await sql.begin(async (tx) => {
      const [t] = await tx<{ expires_at: Date }>`SELECT expires_at FROM transfers WHERE id = ${r.id}`;
      await addTimeline(tx, {
        transferId: r.id,
        kind: "expired",
        source: "app",
        detail: "The claim link expired. The sender can cancel, or anyone can trigger the refund to the sender.",
        at: t ? date(t.expires_at) : now,
      });
      await notifySender(tx, r.id, "transfer_expired");
    });
  }
  return rows.length;
}

export async function pendingTxSweep(sql: Sql, chain: ChainAdapter, limit = 50): Promise<{ checked: number; failed: number }> {
  const now = clock.now();
  const out = { checked: 0, failed: 0 };
  const funding = await sql<{ id: string; funding_tx_hash: string | null; funding_submitted_at: Date | null }>`
    SELECT id, funding_tx_hash, funding_submitted_at FROM transfers
    WHERE status = 'funding_submitted' AND chain_status IS NULL ORDER BY funding_submitted_at ASC NULLS FIRST LIMIT ${limit}`;
  for (const t of funding) {
    out.checked++;
    if (t.funding_tx_hash) {
      try {
        await confirmTransferTx(sql, chain, t.id, t.funding_tx_hash as Hex, "funding");
      } catch (e) {
        if (isTransientError(e)) throw e;
      }
    }
    const submittedAt = t.funding_submitted_at ? date(t.funding_submitted_at) : now;
    if (submittedAt.getTime() <= addSeconds(now, -env.fundingTimeoutSec()).getTime()) {
      const failed = await sql.begin(async (tx) => {
        const rows = await tx`UPDATE transfers SET status = 'failed', updated_at = ${now}
                              WHERE id = ${t.id} AND status = 'funding_submitted' AND chain_status IS NULL RETURNING id`;
        if (!rows.length) return false;
        await addTimeline(tx, {
          transferId: t.id,
          kind: "failed",
          source: "app",
          txHash: t.funding_tx_hash,
          detail: "No confirmed funding on Mezo 30 minutes after the transaction was reported.",
        });
        await audit(tx, "worker", "funding_timeout", t.id, { txHash: t.funding_tx_hash });
        return true;
      });
      if (failed) out.failed++;
    }
  }
  const claims = await sql<{ id: string; claim_submitted_tx: string }>`
    SELECT id, claim_submitted_tx FROM transfers WHERE status = 'claim_submitted' AND claim_submitted_tx IS NOT NULL LIMIT ${limit}`;
  for (const t of claims) {
    out.checked++;
    try {
      await confirmTransferTx(sql, chain, t.id, t.claim_submitted_tx as Hex, "claim");
    } catch (e) {
      if (isTransientError(e)) throw e;
    }
  }
  const relays = await sql<{ id: string; tx_hash: string }>`
    SELECT id, tx_hash FROM relay_attempts WHERE status = 'submitted' AND tx_hash IS NOT NULL ORDER BY created_at ASC LIMIT ${limit}`;
  for (const r of relays) {
    const receipt = await chain.getReceipt(r.tx_hash as Hex);
    if (!receipt) continue;
    await sql`UPDATE relay_attempts SET status = ${receipt.status === "success" ? "confirmed" : "reverted"} WHERE id = ${r.id}`;
  }
  return out;
}
