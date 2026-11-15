// Dashboards (DB state written by the indexer / receipt verifier, corrected by reconciliation).
import type { Address } from "viem";
import type { RecipientDashboard, SenderDashboard } from "@/lib/api-types";
import type { Sql } from "./db";
import { int } from "./db/rows";
import type { Session } from "./auth";
import type { ChainAdapter } from "./chain";
import { trimDecimal } from "./money";
import { listRecipients } from "./recipients";
import { listTransfers } from "./transfers";

export async function senderDashboard(sql: Sql, session: Session): Promise<SenderDashboard> {
  const [t] = await sql<Record<string, unknown>>`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE status IN ('completed', 'claimed')), 0) AS sent_completed,
      count(*)::int AS transfers,
      count(*) FILTER (WHERE status IN ('awaiting_funding', 'funding_submitted', 'awaiting_claim', 'claim_submitted'))::int AS pending,
      count(*) FILTER (WHERE status IN ('completed', 'claimed'))::int AS completed,
      count(*) FILTER (WHERE status IN ('refunded', 'cancelled'))::int AS refunded,
      count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM transfers WHERE sender_user_id = ${session.userId}`;
  const recent = await listTransfers(sql, session, { role: "sent", limit: 10 });
  return {
    totals: {
      sentCompleted: trimDecimal(t.sent_completed),
      transfers: int(t.transfers),
      pending: int(t.pending), // includes claim links past expiry that are not yet refunded (funds still escrowed)
      completed: int(t.completed),
      refunded: int(t.refunded), // refunded + cancelled: funds back with the sender
      failed: int(t.failed),
    },
    recent: recent.transfers,
    recipients: await listRecipients(sql, session.userId),
  };
}

export async function recipientDashboard(sql: Sql, chain: ChainAdapter, session: Session): Promise<RecipientDashboard> {
  const addr = session.address.toLowerCase();
  const [t] = await sql<Record<string, unknown>>`
    SELECT COALESCE(SUM(amount), 0) AS received, count(*)::int AS n FROM transfers
    WHERE recipient_wallet = ${addr} AND sender_user_id <> ${session.userId}
      AND ((method = 'direct' AND chain_status = 'completed' AND status = 'completed') OR (method = 'claim' AND chain_status = 'claimed' AND status = 'claimed'))`;
  const received = await listTransfers(sql, session, { role: "received", limit: 20 });
  let musdBalance: string | null = null;
  try {
    musdBalance = (await chain.musdBalanceOf(addr as Address)).toString();
  } catch {
    musdBalance = null;
  }
  return { totals: { received: trimDecimal(t.received), transfers: int(t.n) }, received: received.transfers, musdBalance };
}
