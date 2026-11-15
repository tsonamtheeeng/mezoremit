// Local-currency payouts — SANDBOX ONLY in this MVP. A payout is a separate record from the on-chain transfer:
// a TransferClaimed event never implies a payout. Rows are simulated=true, timeline entries are source "sandbox",
// and status only ever advances from a VERIFIED provider webhook (see webhooks.ts) — never from client input.

import type { PayoutOption, PayoutRequest } from "@/lib/api-types";
import { findCountry, supportsSandboxPayout } from "@/lib/corridors";
import type { Sql } from "./db";
import { iso, strOrNull } from "./db/rows";
import type { Session } from "./auth";
import { audit } from "./audit";
import { clock } from "./clock";
import { conflict, notFound, unprocessable } from "./errors";
import { addTimeline } from "./indexer";
import { notifyPayout } from "./messages";
import { trimDecimal } from "./money";
import { payoutProviders } from "./providers";
import { SIMULATED_DETAIL } from "./providers/sandbox";
import { createQuote } from "./quotes";

type Row = Record<string, unknown>;

export function serializePayout(r: Row): PayoutRequest {
  return {
    id: String(r.id),
    transferId: String(r.transfer_id),
    provider: String(r.provider),
    simulated: Boolean(r.simulated),
    destinationCurrency: String(r.destination_currency),
    payoutAmount: trimDecimal(r.payout_amount),
    providerReference: strOrNull(r.provider_reference),
    status: r.status as PayoutRequest["status"],
    statusDetail: strOrNull(r.status_detail),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/** The transfer must have delivered MUSD to the session user's wallet (claimed by them, or direct to them). */
async function receivedTransfer(sql: Sql, session: Session, transferId: string): Promise<Row> {
  const [t] = await sql<Row>`SELECT * FROM transfers WHERE id = ${transferId}`;
  const mine =
    t &&
    strOrNull(t.recipient_wallet) === session.address.toLowerCase() &&
    String(t.sender_user_id) !== session.userId &&
    ((t.method === "claim" && t.chain_status === "claimed" && t.status === "claimed") ||
      (t.method === "direct" && t.chain_status === "completed" && t.status === "completed"));
  if (!mine) throw notFound("Transfer not found, or not received by this wallet yet");
  return t;
}

export async function payoutOptions(sql: Sql, session: Session, transferId: string): Promise<PayoutOption[]> {
  const t = await receivedTransfer(sql, session, transferId);
  const country = findCountry(String(t.destination_country));
  if (!country || !supportsSandboxPayout(country.code)) return [];
  return Object.values(payoutProviders)
    .filter((p) => p.supportedCountries().includes(country.code))
    .map((p) => ({
      provider: p.id,
      providerLabel: p.label,
      simulated: p.simulated,
      country: country.code,
      currency: country.currency,
      methods: p.methods(country.code),
      kycRequired: p.kycRequired,
      note: p.note,
    }));
}

export async function createPayout(sql: Sql, session: Session, input: { transferId: string; provider: string }): Promise<PayoutRequest> {
  const t = await receivedTransfer(sql, session, input.transferId);
  const provider = payoutProviders[input.provider];
  if (!provider) throw unprocessable("provider_unsupported", "Unknown payout provider");
  const country = findCountry(String(t.destination_country));
  if (!country || !provider.supportedCountries().includes(country.code)) throw unprocessable("payout_unsupported", "No payout provider for this country");
  const [active] = await sql`SELECT id FROM payout_requests WHERE transfer_id = ${input.transferId} AND status NOT IN ('failed', 'cancelled')`;
  if (active) throw conflict("payout_exists", "A payout for this transfer is already in progress or done");

  // Fresh sandbox quote of the received amount (never a client-supplied number).
  const quote = await createQuote(sql, session.userId, {
    amount: trimDecimal(t.amount),
    destinationCountry: country.code,
    deliveryMethod: "local_payout_sandbox",
    provider: provider.id,
  });
  if (!quote.recipientAmountLocal) throw unprocessable("payout_unsupported", "No local amount for this payout");
  const { providerReference } = await provider.createPayout({
    payoutId: "",
    transferId: input.transferId,
    country: country.code,
    currency: country.currency,
    amountLocal: quote.recipientAmountLocal,
  });
  const now = clock.now();
  try {
    return await sql.begin(async (tx) => {
      const [row] = await tx<Row>`
        INSERT INTO payout_requests (transfer_id, user_id, provider, simulated, destination_currency, payout_amount, quote_id, provider_reference,
          status, status_detail, created_at, updated_at)
        VALUES (${input.transferId}, ${session.userId}, ${provider.id}, ${provider.simulated}, ${country.currency}, ${quote.recipientAmountLocal}::numeric,
          ${quote.id}, ${providerReference}, 'requested', ${provider.simulated ? SIMULATED_DETAIL : null}, ${now}, ${now})
        RETURNING *`;
      await addTimeline(tx, {
        transferId: input.transferId,
        kind: "payout_requested",
        source: "sandbox",
        detail: `${SIMULATED_DETAIL}. ${quote.recipientAmountLocal} ${country.currency} requested.`,
        at: now,
      });
      await notifyPayout(tx, { payoutId: String(row.id), transferId: input.transferId, userId: session.userId, currency: country.currency, amount: quote.recipientAmountLocal! }, "payout_requested");
      await audit(tx, `user:${session.userId}`, "payout_requested", String(row.id), { provider: provider.id, transferId: input.transferId, simulated: provider.simulated });
      return serializePayout(row);
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw conflict("payout_exists", "A payout for this transfer is already in progress or done");
    throw e;
  }
}

export async function getPayout(sql: Sql, session: Session, id: string): Promise<PayoutRequest> {
  const [row] = await sql<Row>`SELECT * FROM payout_requests WHERE id = ${id} AND user_id = ${session.userId}`;
  if (!row) throw notFound("Payout not found");
  return serializePayout(row);
}
