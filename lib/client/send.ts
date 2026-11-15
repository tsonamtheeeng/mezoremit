import { isAddress, type Address } from "viem";
import type { Country, DeliveryMethod, TransferMethod } from "@/lib/api-types";
import { CLAIM_EXPIRY_OPTIONS, MANAGER_LIMITS, type ClaimExpiryKey } from "@/lib/chain/config";

/** Pure helpers for the send flow. Unit tested. */

export type SendStep = "country" | "amount" | "recipient" | "delivery" | "review";
export const SEND_STEPS: { id: SendStep; label: string }[] = [
  { id: "country", label: "Country" },
  { id: "amount", label: "Amount" },
  { id: "recipient", label: "Recipient" },
  { id: "delivery", label: "Delivery" },
  { id: "review", label: "Review" },
];

export function stepIndex(s: SendStep): number {
  return SEND_STEPS.findIndex((x) => x.id === s);
}

/** On-chain method for a delivery choice. Local payout (sandbox) still settles in MUSD first. */
export function methodFor(delivery: DeliveryMethod, hasWallet: boolean): TransferMethod {
  if (delivery === "mezo_wallet") return "direct";
  if (delivery === "claim_link") return "claim";
  return hasWallet ? "direct" : "claim";
}

export interface DeliveryOption {
  id: DeliveryMethod;
  title: string;
  body: string;
  simulated: boolean;
}

export function deliveryOptions(country: Pick<Country, "support"> | null, hasWallet: boolean): DeliveryOption[] {
  const out: DeliveryOption[] = [];
  if (hasWallet) {
    out.push({ id: "mezo_wallet", title: "Mezo wallet", body: "Arrives in their wallet as soon as Mezo confirms it. Nothing for them to do.", simulated: false });
  }
  out.push({
    id: "claim_link",
    title: "Claim link",
    body: "You get a private link to send them. They open it, connect a wallet and claim. You can cancel until they do.",
    simulated: false,
  });
  if (country?.support === "sandbox_payout") {
    out.push({
      id: "local_payout_sandbox",
      title: "Local payout",
      body: hasWallet
        ? "Settles in MUSD to their wallet, then they can try a simulated cash-out to local currency. No real money moves."
        : "Settles in MUSD with a claim link, then they can try a simulated cash-out to local currency. No real money moves.",
      simulated: true,
    });
  }
  return out;
}

/** Absolute expiry (unix seconds) for a claim-link option, clamped to the contract's limits. */
export function expiresAtFor(key: ClaimExpiryKey, nowSec: number): number {
  const secs = Math.min(Math.max(CLAIM_EXPIRY_OPTIONS[key].seconds, MANAGER_LIMITS.TESTNET_MIN_EXPIRY), MANAGER_LIMITS.MAX_EXPIRY);
  return nowSec + secs;
}

export const isDemoExpiry = (key: ClaimExpiryKey) => key === "demo_10m";

export type WalletCheck = { ok: true; address: Address } | { ok: false; message: string };

export function checkWallet(raw: string, self?: string | null): WalletCheck {
  const v = raw.trim();
  if (!v) return { ok: false, message: "Enter their wallet address, or choose a claim link instead." };
  if (!isAddress(v, { strict: false })) return { ok: false, message: "That doesn't look like a wallet address. It starts with 0x and has 42 characters." };
  if (/^0x0{40}$/i.test(v)) return { ok: false, message: "That address can't receive money." };
  if (self && v.toLowerCase() === self.toLowerCase()) return { ok: false, message: "That's your own wallet. Enter your recipient's address." };
  return { ok: true, address: v.toLowerCase() as Address };
}

export function checkName(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "Enter a name so you can recognise this transfer.";
  if (v.length > 80) return "Keep the name under 80 characters.";
  return null;
}

export function checkNote(raw: string): string | null {
  return raw.length > 280 ? "Keep the note under 280 characters." : null;
}

/** Seconds left on a quote (null when there's no quote). */
export function quoteSecondsLeft(expiresAt: string | null | undefined, nowMs: number): number | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - nowMs) / 1000));
}

/** Current unix time in seconds (event handlers only). */
export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Local preference: show my name on claim pages by default (not part of the settings API). */
const SHOW_NAME_KEY = "mezoremit:pref:show-sender-name";
export function loadShowNamePref(): boolean {
  try {
    return localStorage.getItem(SHOW_NAME_KEY) !== "0";
  } catch {
    return true;
  }
}
export function saveShowNamePref(v: boolean): void {
  try {
    localStorage.setItem(SHOW_NAME_KEY, v ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}
