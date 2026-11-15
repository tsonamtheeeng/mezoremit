// "sandbox" provider: MezoRemit Sandbox (simulated). A SIMULATION of a local-currency payout partner for the MX and
// PH pilot corridors. No money moves, no partner is called, no KYC happens. Everything it produces is labelled
// simulated (payout rows: simulated=true, timeline source "sandbox", statusDetail "Simulated — no money moved").
//
// Pricing (demo parameter, disclosed in every quote): providerRate = referenceRate × (1 − 150 bps). 150 bps is a
// made-up illustrative markup so the UI can show how a provider spread would be disclosed. It is NOT a real price.
//
// Webhooks: the worker's simulator posts signed events to POST /api/webhooks/sandbox.
//   header  x-sandbox-signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
//   secret  PROVIDER_WEBHOOK_SECRET_SANDBOX (dev fallback only outside production)
//   window  ±300 s

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DeliveryMethod, PayoutStatus } from "@/lib/api-types";
import { env } from "../env";
import { applyMarkup, convertToLocal } from "../money";
import { NETWORK_FEE_NOTE } from "./onchain";
import type { PayoutProvider, PayoutWebhookEvent, ProviderQuote, QuoteInput, QuoteProvider } from "./types";

export const SANDBOX_ID = "sandbox";
export const SANDBOX_LABEL = "MezoRemit Sandbox (simulated)";
/** Demo parameter (see header). */
export const SANDBOX_MARKUP_BPS = 150;
export const SANDBOX_COUNTRIES = ["MX", "PH"] as const;
export const SANDBOX_CURRENCIES = ["MXN", "PHP"] as const;
export const SIMULATED_DETAIL = "Simulated — no money moved";
export const SIGNATURE_HEADER = "x-sandbox-signature";
export const WEBHOOK_TOLERANCE_SEC = 300;

export function sandboxSign(rawBody: string, tSec: number, secret = env.providerWebhookSecret(SANDBOX_ID)): string {
  if (!secret) throw new Error("PROVIDER_WEBHOOK_SECRET_SANDBOX is not set");
  const mac = createHmac("sha256", secret).update(`${tSec}.${rawBody}`).digest("hex");
  return `t=${tSec},v1=${mac}`;
}

export function verifySandboxSignature(header: string | null, rawBody: string, nowSec: number): boolean {
  const secret = env.providerWebhookSecret(SANDBOX_ID);
  if (!secret || !header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return i < 0 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(nowSec - t) > WEBHOOK_TOLERANCE_SEC) return false;
  if (!/^[0-9a-f]{64}$/.test(parts.v1 ?? "")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  const got = Buffer.from(parts.v1);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const STATUSES: Record<PayoutWebhookEvent["type"], PayoutWebhookEvent["status"]> = {
  "payout.processing": "processing",
  "payout.completed": "completed",
  "payout.failed": "failed",
};

export const sandboxProvider: QuoteProvider & PayoutProvider = {
  id: SANDBOX_ID,
  label: SANDBOX_LABEL,
  simulated: true,
  kycRequired: false,
  note: "Simulation for demo purposes. No money moves and no real payout partner is involved.",
  supportedCountries: () => SANDBOX_COUNTRIES,
  supportedCurrencies: () => SANDBOX_CURRENCIES,
  deliveryMethods: (): DeliveryMethod[] => ["local_payout_sandbox"],
  methods: (country: string) => (country === "MX" ? ["bank_account_spei (simulated)"] : country === "PH" ? ["bank_account (simulated)", "e_wallet (simulated)"] : []),
  quote(input: QuoteInput): ProviderQuote {
    const providerRate18 = applyMarkup(input.referenceRate18, SANDBOX_MARKUP_BPS);
    return {
      providerRate18,
      fxMarkupBps: SANDBOX_MARKUP_BPS,
      serviceFee: 0n,
      recipientAmountMusd: input.amount,
      recipientAmountLocal: convertToLocal(input.amount, providerRate18),
      networkFeeNote: NETWORK_FEE_NOTE,
    };
  },
  async createPayout() {
    return { providerReference: `sbx_${randomBytes(9).toString("hex")}`, status: "requested" as const };
  },
  async getPayoutStatus(): Promise<PayoutStatus | null> {
    return null; // status only arrives via signed webhooks
  },
  verifyWebhook(headers: Headers, rawBody: string, nowSec: number) {
    return verifySandboxSignature(headers.get(SIGNATURE_HEADER), rawBody, nowSec);
  },
  parseWebhook(rawBody: string): PayoutWebhookEvent {
    const b = JSON.parse(rawBody) as Record<string, unknown>;
    const data = (b.data ?? {}) as Record<string, unknown>;
    const type = b.type as PayoutWebhookEvent["type"];
    if (typeof b.id !== "string" || !b.id || b.id.length > 200) throw new Error("missing event id");
    if (!(type in STATUSES)) throw new Error("unknown event type");
    if (typeof data.payoutId !== "string" || typeof data.providerReference !== "string") throw new Error("missing payout reference");
    return {
      id: b.id,
      type,
      payoutId: data.payoutId,
      providerReference: data.providerReference,
      status: STATUSES[type],
      detail: typeof data.detail === "string" ? data.detail.slice(0, 300) : null,
      createdAt: typeof b.createdAt === "string" ? b.createdAt : new Date().toISOString(),
    };
  },
  async cancelPayout() {
    return { ok: true, detail: `${SIMULATED_DETAIL}. Cancelled in the sandbox.` };
  },
};
