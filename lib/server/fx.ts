// Reference FX (mid-market, USD base). Never hardcoded: every rate comes from a live source, cached in-process
// for 1 hour (DB-free). MUSD is treated as ≈ 1 USD for indicative math (the UI says so).
//
//   primary  : FX_REFERENCE_URL (default https://open.er-api.com/v6/latest/USD, keyless, daily updates).
//              Attribution required: "Rates By Exchange Rate API" → https://www.exchangerate-api.com
//              A 429 locks clients out for ~20 min, so a failure backs the primary off for 20 min.
//   fallback : Frankfurter v2 https://api.frankfurter.dev/v2/rates?base=USD&quotes=XXX
//   both fail: RatesUnavailableError → the quote endpoint answers 503 "rates_unavailable" (UI shows MUSD only).

import { clock } from "./clock";
import { env } from "./env";
import { decimalString } from "./money";

export const FX_CACHE_TTL_MS = 60 * 60 * 1000;
const PRIMARY_BACKOFF_MS = 20 * 60 * 1000;

export const OPEN_ER_API_ATTRIBUTION = "Rates By Exchange Rate API (https://www.exchangerate-api.com) via open.er-api.com";
export const FRANKFURTER_ATTRIBUTION = "Frankfurter (api.frankfurter.dev), blended official reference rates";

export interface ReferenceRate {
  currency: string;
  /** 1 USD → `rate` units of currency, decimal string. */
  rate: string;
  source: string; // attribution string shown as Quote.rateSource
  timestamp: Date; // the source's own last-update time
}

export class RatesUnavailableError extends Error {
  constructor(message = "Reference exchange rates are unavailable right now") {
    super(message);
    this.name = "RatesUnavailableError";
  }
}

type FetchFn = typeof fetch;
interface Table {
  rates: Record<string, number>;
  timestamp: Date;
  fetchedAt: number;
}

let primary: Table | null = null;
let primaryFailedAt = 0;
const fallback = new Map<string, { rate: number; timestamp: Date; fetchedAt: number }>();
let fetchImpl: FetchFn | null = null;

export function setFxFetchForTests(f: FetchFn | null) {
  fetchImpl = f;
  primary = null;
  primaryFailedAt = 0;
  fallback.clear();
}

const doFetch = (url: string) => (fetchImpl ?? fetch)(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });

function validRate(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

async function loadPrimary(): Promise<Table> {
  const res = await doFetch(env.fxReferenceUrl());
  if (!res.ok) throw new Error(`open.er-api HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string; base_code?: string; rates?: Record<string, unknown>; time_last_update_unix?: number };
  if (body.result !== "success" || (body.base_code && body.base_code !== "USD") || !body.rates) throw new Error("open.er-api: unexpected payload");
  const rates: Record<string, number> = {};
  for (const [k, v] of Object.entries(body.rates)) if (validRate(v)) rates[k.toUpperCase()] = v;
  const ts = Number(body.time_last_update_unix);
  return { rates, timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : clock.now(), fetchedAt: Date.now() };
}

/** Frankfurter v2 returns [{ date, base, quote, rate }]. Tolerates the v1 { rates: {...}, date } shape too. */
async function loadFallback(currency: string): Promise<{ rate: number; timestamp: Date }> {
  const url = `${env.fxFallbackUrl()}?base=USD&quotes=${encodeURIComponent(currency)}`;
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`frankfurter HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  const items: { quote?: string; rate?: unknown; date?: string; base?: string }[] = Array.isArray(body)
    ? body
    : body && typeof body === "object" && "rates" in body
      ? Object.entries((body as { rates: Record<string, unknown> }).rates).map(([quote, rate]) => ({
          quote,
          rate,
          date: (body as { date?: string }).date,
          base: "USD",
        }))
      : [];
  const hit = items.find((i) => (i.quote ?? "").toUpperCase() === currency && (!i.base || i.base.toUpperCase() === "USD"));
  if (!hit || !validRate(hit.rate)) throw new Error("frankfurter: currency not in response");
  const d = hit.date ? new Date(`${hit.date}T00:00:00Z`) : clock.now();
  return { rate: hit.rate, timestamp: Number.isNaN(d.getTime()) ? clock.now() : d };
}

/** Current reference rate USD → currency. Throws RatesUnavailableError if no live source answers. */
export async function getReferenceRate(currencyIn: string): Promise<ReferenceRate> {
  const currency = currencyIn.toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new RatesUnavailableError(`Unsupported currency ${currencyIn}`);
  const now = Date.now();

  if (primary && now - primary.fetchedAt < FX_CACHE_TTL_MS && validRate(primary.rates[currency])) {
    return { currency, rate: decimalString(primary.rates[currency]), source: OPEN_ER_API_ATTRIBUTION, timestamp: primary.timestamp };
  }
  if (now - primaryFailedAt >= PRIMARY_BACKOFF_MS || !primaryFailedAt) {
    try {
      primary = await loadPrimary();
      primaryFailedAt = 0;
      if (validRate(primary.rates[currency])) {
        return { currency, rate: decimalString(primary.rates[currency]), source: OPEN_ER_API_ATTRIBUTION, timestamp: primary.timestamp };
      }
    } catch (e) {
      primaryFailedAt = now;
      console.warn("[fx] primary source failed:", (e as Error).message);
    }
  }
  const cached = fallback.get(currency);
  if (cached && now - cached.fetchedAt < FX_CACHE_TTL_MS) {
    return { currency, rate: decimalString(cached.rate), source: FRANKFURTER_ATTRIBUTION, timestamp: cached.timestamp };
  }
  try {
    const r = await loadFallback(currency);
    fallback.set(currency, { ...r, fetchedAt: now });
    return { currency, rate: decimalString(r.rate), source: FRANKFURTER_ATTRIBUTION, timestamp: r.timestamp };
  } catch (e) {
    console.warn("[fx] fallback source failed:", (e as Error).message);
  }
  // A stale primary table is better than nothing only within 24h of its fetch (sources update daily).
  if (primary && now - primary.fetchedAt < 24 * FX_CACHE_TTL_MS && validRate(primary.rates[currency])) {
    return { currency, rate: decimalString(primary.rates[currency]), source: OPEN_ER_API_ATTRIBUTION, timestamp: primary.timestamp };
  }
  throw new RatesUnavailableError();
}
