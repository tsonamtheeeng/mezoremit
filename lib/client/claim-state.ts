import type { Address, Hex } from "viem";
import type { ClaimInfo, TransferStatus } from "@/lib/api-types";
import { CHAIN_STATUS, type ChainStatus } from "@/lib/chain/config";
import { claimSignerOf, parseClaimFragment } from "@/lib/chain/claim";

/** What the claim page shows. Pure, so it is unit tested. */
export type ClaimPageState =
  | { kind: "loading" }
  | { kind: "invalid"; reason: "missing_key" | "malformed_key" | "wrong_key" | "not_found" }
  | { kind: "unavailable" } // neither the API nor the chain could be read
  | { kind: "not_funded" } // created but the sender hasn't funded it yet
  | { kind: "expired" }
  | { kind: "claim_pending" }
  | { kind: "claimed"; claimedBy: string | null; txHash: string | null }
  | { kind: "cancelled"; txHash: string | null }
  | { kind: "refunded"; txHash: string | null }
  | { kind: "claimable" };

/** On-chain view of a transfer, normalized from getTransfer(). */
export interface ChainTransferView {
  id: bigint;
  status: ChainStatus;
  claimSigner: string;
  recipient: string;
  amount: bigint;
  expiresAt: number; // unix seconds
}

export type KeyRead = { ok: true; key: Hex; signer: Address } | { ok: false; reason: "missing_key" | "malformed_key" };

/** Read the claim key from a location hash ("#k=..."). Never sends it anywhere. */
export function readKeyFromHash(hash: string): KeyRead {
  if (!hash || !/k=/.test(hash)) return { ok: false, reason: "missing_key" };
  const key = parseClaimFragment(hash);
  if (!key) return { ok: false, reason: "malformed_key" };
  try {
    return { ok: true, key, signer: claimSignerOf(key) };
  } catch {
    return { ok: false, reason: "malformed_key" };
  }
}

export function chainStatusName(n: number | bigint): ChainStatus {
  return CHAIN_STATUS[Number(n)] ?? "none";
}

const lower = (s: string | null | undefined) => (s ? s.toLowerCase() : null);

export function deriveClaimState(input: {
  key: KeyRead;
  info: ClaimInfo | null | undefined;
  infoLoading: boolean;
  infoNotFound: boolean;
  chain: ChainTransferView | null | undefined;
  chainLoading: boolean;
  nowSec: number;
}): ClaimPageState {
  const { key, info, chain } = input;
  if (!key.ok) return { kind: "invalid", reason: key.reason };
  if ((input.infoLoading && !info) || (input.chainLoading && !chain && !info)) return { kind: "loading" };
  if (!info && !chain) return input.infoNotFound ? { kind: "invalid", reason: "not_found" } : { kind: "unavailable" };

  // Key check: chain is the authority; the API's copy is the fallback.
  const signer = lower(chain?.claimSigner && !/^0x0{40}$/i.test(chain.claimSigner) ? chain.claimSigner : info?.claimSigner);
  if (signer && signer !== key.signer.toLowerCase()) return { kind: "invalid", reason: "wrong_key" };

  if (chain && chain.status !== "none") {
    switch (chain.status) {
      case "claimed":
        return { kind: "claimed", claimedBy: chain.recipient || info?.claimedBy || null, txHash: info?.settlementTxHash ?? null };
      case "cancelled":
        return { kind: "cancelled", txHash: info?.settlementTxHash ?? null };
      case "refunded":
        return { kind: "refunded", txHash: info?.settlementTxHash ?? null };
      case "completed":
        return { kind: "invalid", reason: "not_found" };
      case "funded":
        if (chain.expiresAt && input.nowSec >= chain.expiresAt) return { kind: "expired" };
        if (info?.status === "claim_submitted") return { kind: "claim_pending" };
        return { kind: "claimable" };
    }
  }
  if (!info) return { kind: "invalid", reason: "not_found" };
  return fromApiStatus(info.status, info, input.nowSec);
}

function fromApiStatus(status: TransferStatus, info: ClaimInfo, nowSec: number): ClaimPageState {
  switch (status) {
    case "awaiting_funding":
    case "funding_submitted":
    case "failed":
      return { kind: "not_funded" };
    case "awaiting_claim": {
      const exp = info.expiresAt ? Math.floor(new Date(info.expiresAt).getTime() / 1000) : null;
      if (exp !== null && nowSec >= exp) return { kind: "expired" };
      return { kind: "claimable" };
    }
    case "claim_submitted":
      return { kind: "claim_pending" };
    case "claimed":
      return { kind: "claimed", claimedBy: info.claimedBy, txHash: info.settlementTxHash };
    case "expired":
      return { kind: "expired" };
    case "cancelled":
      return { kind: "cancelled", txHash: info.settlementTxHash };
    case "refunded":
      return { kind: "refunded", txHash: info.settlementTxHash };
    case "completed":
      return { kind: "invalid", reason: "not_found" };
  }
}

export const INVALID_COPY: Record<"missing_key" | "malformed_key" | "wrong_key" | "not_found", { title: string; body: string }> = {
  missing_key: {
    title: "This link is incomplete",
    body: "The secret part at the end of the link is missing. Ask the sender to send the full link again.",
  },
  malformed_key: {
    title: "This link is damaged",
    body: "Part of the link was cut off or changed. Ask the sender to send the full link again.",
  },
  wrong_key: {
    title: "This link doesn't match the transfer",
    body: "The secret in this link isn't the one for this transfer. Ask the sender for the right link.",
  },
  not_found: {
    title: "We can't find this transfer",
    body: "The link may be wrong, or the transfer was never created. Check with the sender.",
  },
};
