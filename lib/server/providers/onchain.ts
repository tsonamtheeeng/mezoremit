// "onchain" provider (REAL): the recipient receives MUSD on Mezo. There is no local-currency leg, so no provider
// rate and recipientAmountLocal is null (the reference rate is shown as information only).
import type { DeliveryMethod } from "@/lib/api-types";
import { COUNTRIES } from "@/lib/corridors";
import type { ProviderQuote, QuoteInput, QuoteProvider } from "./types";

export const NETWORK_FEE_NOTE =
  "Network fee is paid in BTC by the wallet that submits the transaction (your wallet when you send; for claims, " +
  "the MezoRemit relayer when available, otherwise the recipient). It is not taken from the amount.";

export const onchainProvider: QuoteProvider = {
  id: "onchain",
  label: "MUSD on Mezo",
  simulated: false,
  supportedCountries: () => COUNTRIES.map((c) => c.code),
  supportedCurrencies: () => Array.from(new Set(COUNTRIES.map((c) => c.currency))),
  deliveryMethods: (): DeliveryMethod[] => ["mezo_wallet", "claim_link"],
  quote(input: QuoteInput): ProviderQuote {
    return {
      providerRate18: null,
      fxMarkupBps: 0,
      serviceFee: 0n,
      recipientAmountMusd: input.amount,
      recipientAmountLocal: null,
      networkFeeNote: NETWORK_FEE_NOTE,
    };
  },
};
