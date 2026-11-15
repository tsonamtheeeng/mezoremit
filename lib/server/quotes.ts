// Indicative quotes: reference FX (live source) + provider rate + fees. Persisted in transfer_quotes, 60 s expiry.
// "indicative" means reference data only — nothing is locked or executable in this MVP.

import type { DeliveryMethod, Quote } from "@/lib/api-types";
import { findCountry, supportsSandboxPayout, EXCLUDED_COUNTRIES } from "@/lib/corridors";
import type { Sql } from "./db";
import { int, iso, strOrNull } from "./db/rows";
import { addSeconds, clock } from "./clock";
import { HttpError, unavailable, unprocessable } from "./errors";
import { getReferenceRate, RatesUnavailableError } from "./fx";
import { fixed18ToString, MAX_AMOUNT, toFixed18, trimDecimal } from "./money";
import { providerLabel, quoteProviderFor, quoteProviders } from "./providers";
import { NETWORK_FEE_NOTE } from "./providers/onchain";

export const QUOTE_TTL_SECONDS = 60;

export function parseAmount(v: string): bigint {
  if (typeof v !== "string" || !/^[1-9]\d{0,77}$/.test(v)) throw new HttpError(400, "invalid_amount", "amount must be a positive integer string of MUSD base units");
  const a = BigInt(v);
  if (a > MAX_AMOUNT) throw new HttpError(400, "amount_too_large", "amount exceeds the per-transfer maximum");
  return a;
}

export function resolveCountry(code: string) {
  const c = findCountry(code);
  if (!c) {
    const why = EXCLUDED_COUNTRIES[(code || "").toUpperCase()];
    throw unprocessable("country_unsupported", why ?? "This destination country is not supported");
  }
  return c;
}

export function serializeQuote(r: Record<string, unknown>): Quote {
  const provider = String(r.provider);
  return {
    id: String(r.id),
    kind: r.kind === "executable" ? "executable" : "indicative",
    sourceCurrency: "MUSD",
    sourceAmount: trimDecimal(r.source_amount),
    destinationCurrency: String(r.destination_currency),
    referenceRate: trimDecimal(r.reference_rate),
    providerRate: r.provider_rate === null || r.provider_rate === undefined ? null : trimDecimal(r.provider_rate),
    fxMarkupBps: int(r.fx_markup_bps),
    serviceFee: trimDecimal(r.service_fee),
    networkFeeNote: NETWORK_FEE_NOTE,
    recipientAmountMusd: trimDecimal(r.recipient_amount_musd),
    recipientAmountLocal: r.recipient_amount_local === null || r.recipient_amount_local === undefined ? null : trimDecimal(r.recipient_amount_local),
    provider,
    providerLabel: providerLabel(provider),
    rateSource: String(r.rate_source),
    rateTimestamp: iso(r.rate_timestamp),
    expiresAt: iso(r.expires_at),
    createdAt: iso(r.created_at),
  };
}

export async function createQuote(
  sql: Sql,
  userId: string,
  input: { amount: string; destinationCountry: string; deliveryMethod: DeliveryMethod; provider?: string },
): Promise<Quote> {
  const amount = parseAmount(input.amount);
  const country = resolveCountry(input.destinationCountry);
  if (input.deliveryMethod === "local_payout_sandbox" && !supportsSandboxPayout(country.code)) {
    throw unprocessable("payout_unsupported", `Local payout (sandbox) is only available for Mexico and the Philippines`);
  }
  const provider = input.provider ? quoteProviders[input.provider] : quoteProviderFor(input.deliveryMethod);
  if (!provider || !provider.supportedCountries().includes(country.code)) throw unprocessable("provider_unsupported", "No provider for this destination");

  let ref;
  try {
    ref = await getReferenceRate(country.currency);
  } catch (e) {
    if (e instanceof RatesUnavailableError) throw unavailable("rates_unavailable", "Exchange rates are unavailable right now. You can still send MUSD.");
    throw e;
  }
  const referenceRate18 = toFixed18(ref.rate);
  const q = provider.quote({ amount, country: country.code, currency: country.currency, deliveryMethod: input.deliveryMethod, referenceRate18 });
  const now = clock.now();
  const [row] = await sql<Record<string, unknown>>`
    INSERT INTO transfer_quotes (user_id, kind, source_currency, source_amount, destination_country, destination_currency, delivery_method,
      reference_rate, provider_rate, fx_markup_bps, service_fee, recipient_amount_musd, recipient_amount_local, provider, rate_source,
      rate_timestamp, expires_at, created_at)
    VALUES (${userId}, 'indicative', 'MUSD', ${amount}::numeric, ${country.code}, ${country.currency}, ${input.deliveryMethod},
      ${fixed18ToString(referenceRate18)}::numeric, ${q.providerRate18 === null ? null : fixed18ToString(q.providerRate18)}::numeric,
      ${q.fxMarkupBps}, ${q.serviceFee}::numeric, ${q.recipientAmountMusd}::numeric, ${q.recipientAmountLocal}::numeric, ${provider.id},
      ${ref.source}, ${ref.timestamp}, ${addSeconds(now, QUOTE_TTL_SECONDS)}, ${now})
    RETURNING *`;
  return serializeQuote(row);
}

export async function loadQuote(sql: Sql, id: string | null): Promise<Quote | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await sql<Record<string, unknown>>`SELECT * FROM transfer_quotes WHERE id = ${id}`;
  return row ? serializeQuote(row) : null;
}

/** The quote must be the caller's, unexpired, and for the same amount + country — else 409 quote_expired. */
export async function assertUsableQuote(sql: Sql, userId: string, quoteId: string, amount: bigint, country: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(quoteId)) throw new HttpError(409, "quote_expired", "This quote is no longer valid. Get a new quote.", { reason: "not_found" });
  const [row] = await sql<Record<string, unknown>>`SELECT user_id, source_amount, destination_country, expires_at FROM transfer_quotes WHERE id = ${quoteId}`;
  const fail = (why: string) => new HttpError(409, "quote_expired", "This quote is no longer valid. Get a new quote.", { reason: why });
  if (!row || strOrNull(row.user_id) !== userId) throw fail("not_found");
  if (new Date(row.expires_at as string).getTime() <= clock.now().getTime()) throw fail("expired");
  if (trimDecimal(row.source_amount) !== amount.toString()) throw fail("amount_mismatch");
  if (String(row.destination_country) !== country) throw fail("country_mismatch");
}
