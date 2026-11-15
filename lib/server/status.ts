// Status projection. Stored `transfers.status` is the app lifecycle; `expired` is DERIVED here and never stored:
// a claimable transfer whose escrow is still Funded on-chain and whose expires_at has passed.

import type { TransferStatus } from "@/lib/api-types";
import type { ChainStatus } from "@/lib/chain/config";

export interface StatusInput {
  method: string;
  status: string;
  chain_status: string | null;
  expires_at: Date | string | null;
}

export function projectStatus(t: StatusInput, now: Date): TransferStatus {
  const s = t.status as TransferStatus;
  if (
    t.method === "claim" &&
    t.chain_status === "funded" &&
    t.expires_at &&
    (s === "awaiting_claim" || s === "claim_submitted") &&
    new Date(t.expires_at).getTime() <= now.getTime()
  ) {
    return "expired";
  }
  return s;
}

/** Stored status implied by a verified on-chain status. */
export function statusFromChain(chain: ChainStatus): TransferStatus | null {
  switch (chain) {
    case "funded":
      return "awaiting_claim";
    case "claimed":
      return "claimed";
    case "cancelled":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "completed":
      return "completed";
    default:
      return null;
  }
}

export const TERMINAL_STATUSES: readonly TransferStatus[] = ["claimed", "completed", "cancelled", "refunded", "failed"];
export const PENDING_STATUSES: readonly TransferStatus[] = ["awaiting_funding", "funding_submitted", "awaiting_claim", "claim_submitted", "expired"];
