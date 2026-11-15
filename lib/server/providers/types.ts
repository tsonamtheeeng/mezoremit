// Provider-agnostic fiat integration layer. The MVP ships two implementations:
//   - "onchain"  (real): MUSD lands on Mezo; no local-currency leg. QuoteProvider only.
//   - "sandbox"  (SIMULATED): "MezoRemit Sandbox (simulated)". QuoteProvider + PayoutProvider for MX/PH. No money moves.
// OnRampProvider / OffRampProvider are interfaces only: per docs/FIAT_AND_CORRIDORS.md no provider sandbox can
// deliver Mezo-testnet MUSD, so a real integration (e.g. Banxa on-ramp, mainnet) plugs in here later.

import type { DeliveryMethod, PayoutStatus } from "@/lib/api-types";

export interface ProviderInfo {
  id: string;
  label: string;
  /** true = nothing real happens; every surface must say so. */
  simulated: boolean;
}

export interface QuoteInput {
  amount: bigint; // MUSD base units
  country: string;
  currency: string;
  deliveryMethod: DeliveryMethod;
  /** Mid-market reference rate as 18-dec fixed point (1 USD → currency). */
  referenceRate18: bigint;
}

export interface ProviderQuote {
  providerRate18: bigint | null;
  fxMarkupBps: number;
  serviceFee: bigint; // MUSD base units
  recipientAmountMusd: bigint;
  recipientAmountLocal: string | null; // decimal, 6 dp max
  networkFeeNote: string;
}

export interface QuoteProvider extends ProviderInfo {
  supportedCountries(): readonly string[];
  supportedCurrencies(): readonly string[];
  deliveryMethods(): readonly DeliveryMethod[];
  quote(input: QuoteInput): ProviderQuote;
}

export interface OnRampProvider extends ProviderInfo {
  supportedCountries(): readonly string[];
  supportedCurrencies(): readonly string[];
  kycRequired: boolean;
  /** Hosted widget session that ends with MUSD delivered to `wallet` on Mezo. */
  createSession(input: { wallet: string; fiatCurrency: string; fiatAmount: string }): Promise<{ url: string; providerReference: string }>;
}

export interface OffRampProvider extends ProviderInfo {
  supportedCountries(): readonly string[];
  supportedCurrencies(): readonly string[];
  kycRequired: boolean;
  /** Where the user would send MUSD to be sold for fiat. */
  createSale(input: { wallet: string; amount: bigint; fiatCurrency: string }): Promise<{ depositAddress: string; providerReference: string }>;
}

export interface PayoutCreateInput {
  payoutId: string;
  transferId: string;
  country: string;
  currency: string;
  amountLocal: string;
}

export interface PayoutWebhookEvent {
  id: string; // provider event id (idempotency key)
  type: "payout.processing" | "payout.completed" | "payout.failed";
  payoutId: string;
  providerReference: string;
  status: Extract<PayoutStatus, "processing" | "completed" | "failed">;
  detail: string | null;
  createdAt: string;
}

export interface PayoutProvider extends ProviderInfo {
  supportedCountries(): readonly string[];
  supportedCurrencies(): readonly string[];
  methods(country: string): string[];
  kycRequired: boolean;
  note: string;
  createPayout(input: PayoutCreateInput): Promise<{ providerReference: string; status: "requested" }>;
  getPayoutStatus(providerReference: string): Promise<PayoutStatus | null>;
  /** Verify a webhook against the provider's secret. Never throws; false on any doubt. */
  verifyWebhook(headers: Headers, rawBody: string, nowSec: number): boolean;
  parseWebhook(rawBody: string): PayoutWebhookEvent;
  /** Cancel / refund a payout that has not completed. */
  cancelPayout(providerReference: string): Promise<{ ok: boolean; detail: string }>;
}
