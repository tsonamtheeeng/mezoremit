import type { DeliveryMethod } from "@/lib/api-types";
import { onchainProvider } from "./onchain";
import { sandboxProvider } from "./sandbox";
import type { PayoutProvider, QuoteProvider } from "./types";

export const quoteProviders: Record<string, QuoteProvider> = { onchain: onchainProvider, sandbox: sandboxProvider };
export const payoutProviders: Record<string, PayoutProvider> = { sandbox: sandboxProvider };

export function quoteProviderFor(method: DeliveryMethod): QuoteProvider {
  return method === "local_payout_sandbox" ? sandboxProvider : onchainProvider;
}

export function providerLabel(id: string): string {
  return quoteProviders[id]?.label ?? payoutProviders[id]?.label ?? id;
}

export type * from "./types";
