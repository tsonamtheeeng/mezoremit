// Fixed-point helpers. MUSD has 18 decimals; FX rates are handled as 18-decimal fixed-point bigints.
import { formatUnits, parseUnits } from "viem";
import { MANAGER_LIMITS, MUSD_DECIMALS } from "@/lib/chain/config";

export const ONE = 10n ** 18n;
export const MAX_AMOUNT = BigInt(MANAGER_LIMITS.MAX_AMOUNT_MUSD) * ONE;

/** "25000000000000000000" → "25"; "1500000000000000000" → "1.5". */
export function formatMusd(baseUnits: bigint | string): string {
  return formatUnits(BigInt(baseUnits), MUSD_DECIMALS);
}

/** Parse a decimal string to 18-decimal fixed point (throws on garbage). */
export function toFixed18(decimal: string | number): bigint {
  const s = typeof decimal === "number" ? decimalString(decimal) : decimal.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`not a non-negative decimal: ${s}`);
  const [i, f = ""] = s.split(".");
  return parseUnits(`${i}.${f.slice(0, 18) || "0"}`, 18);
}

/** Number → plain decimal string without exponent notation. */
export function decimalString(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad number ${n}`);
  return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 18 });
}

/** 18-dec fixed → trimmed decimal string ("18.5824"). */
export function fixed18ToString(v: bigint): string {
  return formatUnits(v, 18);
}

/** amount (MUSD base units) × rate (18-dec fixed) → local amount, floored to 6 decimals, as a decimal string. */
export function convertToLocal(amount: bigint, rate18: bigint): string {
  const micro = (amount * rate18) / 10n ** 30n; // 18 + 18 - 6
  return formatUnits(micro, 6);
}

/** Apply a markup in basis points (rate × (1 − bps/10000)), floored. */
export function applyMarkup(rate18: bigint, bps: number): bigint {
  return (rate18 * BigInt(10_000 - bps)) / 10_000n;
}

/** Trim a NUMERIC string from the DB ("123.450000" → "123.45"). */
export function trimDecimal(v: unknown): string {
  const s = String(v ?? "0");
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}
