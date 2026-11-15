import { formatUnits } from "viem";
import { MUSD_DECIMALS } from "@/lib/chain/config";

/** Display-only helpers. Amounts stay bigint / base-unit strings everywhere else. */

export const DASH = "--";

export function toBaseUnits(v: bigint | string | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v;
  const t = v.trim();
  if (!/^-?\d+$/.test(t)) return null;
  return BigInt(t);
}

/** Round base units to `decimals` places (half up, away from zero) and group the whole part. */
function fixed(wei: bigint, decimals: number): string {
  const neg = wei < 0n;
  let abs = neg ? -wei : wei;
  const unit = 10n ** BigInt(MUSD_DECIMALS - decimals);
  if (decimals < MUSD_DECIMALS) abs = ((abs + unit / 2n) / unit) * unit;
  const s = formatUnits(abs, MUSD_DECIMALS);
  const [whole, frac = ""] = s.split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  const f = decimals > 0 ? "." + frac.padEnd(decimals, "0").slice(0, decimals) : "";
  const out = `${grouped}${f}`;
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

/** "25.00" (no symbol). Null/invalid → "--". */
export function musdNumber(v: bigint | string | null | undefined, decimals = 2): string {
  const wei = toBaseUnits(v);
  return wei === null ? DASH : fixed(wei, decimals);
}

/** "25.00 MUSD". */
export function musd(v: bigint | string | null | undefined, decimals = 2): string {
  const n = musdNumber(v, decimals);
  return n === DASH ? DASH : `${n} MUSD`;
}

/** Full precision with trailing zeros trimmed: "25.5". */
export function musdExact(v: bigint | string | null | undefined): string {
  const wei = toBaseUnits(v);
  if (wei === null) return DASH;
  const s = formatUnits(wei, MUSD_DECIMALS);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** Local currency via Intl ("₱1,412.30"). `amount` is a decimal string. */
/** Unambiguous symbols for the currencies we list (fixed, so server and browser render the same text). */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  CAD: "C$",
  MXN: "MX$",
  PHP: "₱",
  INR: "₹",
  GBP: "£",
  EUR: "€",
  MUSD: "MUSD",
};

/** "₱" for PHP, "MX$" for MXN. Falls back to the ISO code. */
export function currencySymbol(currency: string | null | undefined): string {
  if (!currency) return "";
  const c = currency.toUpperCase();
  return CURRENCY_SYMBOLS[c] ?? c;
}

/** "₱1,425.50 PHP": symbol, grouped amount with 2 decimals, then the ISO code so it is never ambiguous. */
export function localMoney(amount: string | number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "" || !currency) return DASH;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return DASH;
  const c = currency.toUpperCase();
  const num = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = currencySymbol(c);
  return sym === c ? `${num} ${c}` : `${sym}${num} ${c}`;
}

/** "1 USD = 17.0412 MXN" style rate text. */
export function rateText(rate: string | null | undefined, currency: string): string {
  if (!rate) return DASH;
  const n = Number(rate);
  if (!Number.isFinite(n)) return DASH;
  const digits = n >= 100 ? 2 : 4;
  return `1 MUSD ≈ ${n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 2 })} ${currency}`;
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

export function btc(v: bigint | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const s = formatUnits(v, 18);
  const n = Number(s);
  if (n === 0) return "0 BTC";
  if (n < 0.000001) return "<0.000001 BTC";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} BTC`;
}

export function shortAddress(a: string | null | undefined): string {
  if (!a) return DASH;
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
export const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : DASH);

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : DASH;
}

export function formatDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : DASH;
}

/** "in 3 days" / "5 minutes ago" / "just now". */
export function relativeTime(v: string | number | Date | null | undefined, now: number = Date.now()): string {
  const d = toDate(v);
  if (!d) return DASH;
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") return rtf.format(Math.round(diff / ms), unit);
  }
  return DASH;
}

/** "0:42" countdown text for quote expiry. */
export function countdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "Mexico (MX$ MXN)". */
export function countryLabel(c: { name: string; currency: string } | null | undefined, code?: string): string {
  if (!c) return code ?? DASH;
  return `${c.name} (${currencyTag(c.currency)})`;
}

/** "₱ PHP", or just "USD"-style code when the symbol is the code. */
export function currencyTag(currency: string): string {
  const sym = currencySymbol(currency);
  return sym === currency.toUpperCase() ? currency.toUpperCase() : `${sym} ${currency.toUpperCase()}`;
}
