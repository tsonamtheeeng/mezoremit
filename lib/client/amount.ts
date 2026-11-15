import { parseUnits } from "viem";
import { MANAGER_LIMITS, MUSD_DECIMALS } from "@/lib/chain/config";

/**
 * Amount entry for MUSD. Users type "25", "25.5", "1,000.25". Anything else is rejected with a plain message.
 * Pure, so it is unit tested.
 */
export type AmountCheck =
  | { ok: true; value: bigint }
  | { ok: false; reason: "empty" | "format" | "precision" | "zero" | "too_large" | "balance"; message: string };

export const MIN_SEND_MUSD = 1n; // whole MUSD; keeps dust out of escrow
const MAX = BigInt(MANAGER_LIMITS.MAX_AMOUNT_MUSD) * 10n ** BigInt(MUSD_DECIMALS);
const MIN = MIN_SEND_MUSD * 10n ** BigInt(MUSD_DECIMALS);

/** Normalize user input: trims, drops thousands separators, keeps one dot. Returns null if not a number shape. */
export function normalizeAmountInput(raw: string): string | null {
  const t = raw.trim().replace(/[\s,_]/g, "");
  if (t === "") return "";
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return null;
  const [w, f] = t.split(".");
  const whole = (w || "0").replace(/^0+(?=\d)/, "");
  return f !== undefined ? `${whole}.${f}` : whole;
}

export function parseAmount(raw: string): bigint | null {
  const n = normalizeAmountInput(raw);
  if (!n) return null;
  const frac = n.split(".")[1] ?? "";
  if (frac.length > MUSD_DECIMALS) return null;
  try {
    return parseUnits(n.endsWith(".") ? n.slice(0, -1) : n, MUSD_DECIMALS);
  } catch {
    return null;
  }
}

export function checkAmount(raw: string, balance?: bigint | null): AmountCheck {
  const n = normalizeAmountInput(raw);
  if (n === "") return { ok: false, reason: "empty", message: "Enter an amount." };
  if (n === null) return { ok: false, reason: "format", message: "Use numbers only, like 25 or 25.50." };
  const frac = n.split(".")[1] ?? "";
  if (frac.length > 2) return { ok: false, reason: "precision", message: "Use at most 2 decimal places." };
  const v = parseAmount(n);
  if (v === null) return { ok: false, reason: "format", message: "Use numbers only, like 25 or 25.50." };
  if (v === 0n) return { ok: false, reason: "zero", message: "Enter an amount above zero." };
  if (v < MIN) return { ok: false, reason: "zero", message: `The smallest transfer is ${MIN_SEND_MUSD} MUSD.` };
  if (v > MAX) return { ok: false, reason: "too_large", message: `The most you can send at once is ${MANAGER_LIMITS.MAX_AMOUNT_MUSD.toLocaleString("en-US")} MUSD.` };
  if (balance !== undefined && balance !== null && v > balance) {
    return { ok: false, reason: "balance", message: "That's more MUSD than this wallet holds." };
  }
  return { ok: true, value: v };
}

/** What the recipient gets on Mezo: amount minus service fee, never below zero. */
export function recipientReceives(amount: bigint, serviceFee: bigint): bigint {
  return amount > serviceFee ? amount - serviceFee : 0n;
}

/** Indicative local amount = MUSD × rate (MUSD treated as ≈ 1 USD). Returns a decimal string with 2 places. */
export function indicativeLocal(amountBase: bigint, rate: string | null | undefined): string | null {
  if (!rate) return null;
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return null;
  // scale rate to 8 decimals to stay in bigint math
  const rateScaled = BigInt(Math.round(r * 1e8));
  const cents = (amountBase * rateScaled * 100n) / (10n ** BigInt(MUSD_DECIMALS) * 100_000_000n);
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}
