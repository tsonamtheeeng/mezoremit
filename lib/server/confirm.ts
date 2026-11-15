// Receipt verifier: turns a client-reported tx hash into settlement truth using the SAME ingest function as the
// indexer. Only logs emitted by contracts.manager count, the receipt must be buried under CONFIRMATIONS blocks,
// and a funding receipt must carry an event for THIS transfer's ref.

import type { Hex } from "viem";
import type { Sql } from "./db";
import { big } from "./db/rows";
import { decodeLog, type ChainAdapter, type DecodedLog } from "./chain";
import { audit } from "./audit";
import { clock } from "./clock";
import { env } from "./env";
import { addTimeline, ingestLogs } from "./indexer";

export type ConfirmState = "pending" | "confirming" | "confirmed" | "reverted" | "no_matching_event";

interface Row {
  id: string;
  ref: string;
  method: string;
  status: string;
  chain_status: string | null;
  chain_transfer_id: unknown;
  funding_tx_hash: string | null;
  claim_submitted_tx: string | null;
}

const lc = (v: unknown) => String(v ?? "").toLowerCase();

function matchesTransfer(l: DecodedLog, row: Row, purpose: "funding" | "claim"): boolean {
  if (purpose === "funding") return (l.eventName === "ClaimableCreated" || l.eventName === "DirectTransferSent") && lc(l.args.ref) === lc(row.ref);
  if (row.chain_transfer_id === null) return false;
  return (
    (l.eventName === "TransferClaimed" || l.eventName === "TransferCancelled" || l.eventName === "TransferRefunded") &&
    (l.args.transferId as bigint) === big(row.chain_transfer_id)
  );
}

export async function confirmTransferTx(sql: Sql, chain: ChainAdapter, transferId: string, txHash: Hex, purpose: "funding" | "claim"): Promise<ConfirmState> {
  const [row] = await sql<Row>`SELECT id, ref, method, status, chain_status, chain_transfer_id, funding_tx_hash, claim_submitted_tx FROM transfers WHERE id = ${transferId}`;
  if (!row) return "pending";
  const receipt = await chain.getReceipt(txHash);
  if (!receipt) return "pending";
  const h = txHash.toLowerCase();

  if (receipt.status !== "success") {
    if (purpose === "funding" && row.chain_status === null && lc(row.funding_tx_hash) === h) {
      await sql.begin(async (tx) => {
        await tx`UPDATE transfers SET status = 'failed', updated_at = ${clock.now()} WHERE id = ${row.id} AND chain_status IS NULL`;
        await addTimeline(tx, { transferId: row.id, kind: "failed", source: "app", txHash: h, detail: "Funding transaction reverted on Mezo. No funds moved." });
        await audit(tx, "worker", "funding_reverted", row.id, { txHash: h });
      });
    }
    if (purpose === "claim" && row.status === "claim_submitted" && lc(row.claim_submitted_tx) === h) {
      await sql.begin(async (tx) => {
        await tx`UPDATE transfers SET status = 'awaiting_claim', claim_submitted_tx = NULL, updated_at = ${clock.now()}
                 WHERE id = ${row.id} AND status = 'claim_submitted' AND chain_status = 'funded'`;
        await tx`UPDATE relay_attempts SET status = 'reverted' WHERE tx_hash = ${h}`;
        await audit(tx, "worker", "claim_reverted", row.id, { txHash: h });
      });
    }
    return "reverted";
  }

  const head = await chain.getBlockNumber();
  if (receipt.blockNumber + BigInt(env.confirmations()) > head) return "confirming";
  // decodeLog drops every log not emitted by contracts.manager.
  const logs = receipt.logs.map(decodeLog).filter((l): l is DecodedLog => l !== null);
  if (logs.length) await ingestLogs(sql, chain, logs);
  if (purpose === "claim" && row.chain_transfer_id === null) {
    const [fresh] = await sql<Row>`SELECT * FROM transfers WHERE id = ${row.id}`;
    return logs.some((l) => matchesTransfer(l, fresh, purpose)) ? "confirmed" : "no_matching_event";
  }
  return logs.some((l) => matchesTransfer(l, row, purpose)) ? "confirmed" : "no_matching_event";
}
