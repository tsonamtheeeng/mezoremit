import { describe, expect, it } from "vitest";
import type { ClaimInfo } from "@/lib/api-types";
import { newClaimKey } from "@/lib/chain/claim";
import { deriveClaimState, readKeyFromHash, type ChainTransferView, type KeyRead } from "@/lib/client/claim-state";

const { privateKey, claimSigner } = newClaimKey();
const other = newClaimKey();
const goodHash = `#k=${privateKey.slice(2)}`;
const NOW = 1_800_000_000;

function info(p: Partial<ClaimInfo> = {}): ClaimInfo {
  return {
    transferId: "t",
    chainTransferId: "3",
    senderAddress: "0x00000000000000000000000000000000000000a1",
    status: "awaiting_claim",
    amount: "25000000000000000000",
    expiresAt: new Date((NOW + 3600) * 1000).toISOString(),
    claimSigner: claimSigner.toLowerCase(),
    claimedBy: null,
    settlementTxHash: null,
    fundingTxHash: "0xabc",
    relayAvailable: true,
    ...p,
  };
}
function chain(p: Partial<ChainTransferView> = {}): ChainTransferView {
  return { id: 3n, status: "funded", claimSigner, recipient: "0x0000000000000000000000000000000000000000", amount: 25n, expiresAt: NOW + 3600, ...p };
}
const key = readKeyFromHash(goodHash) as KeyRead;
const base = { key, info: info(), infoLoading: false, infoNotFound: false, chain: null, chainLoading: false, nowSec: NOW };

describe("claim fragment", () => {
  it("reads a valid key and derives its signer", () => {
    expect(key).toMatchObject({ ok: true, signer: claimSigner });
  });
  it("rejects missing and malformed fragments", () => {
    expect(readKeyFromHash("")).toEqual({ ok: false, reason: "missing_key" });
    expect(readKeyFromHash("#foo=bar")).toEqual({ ok: false, reason: "missing_key" });
    expect(readKeyFromHash("#k=1234")).toEqual({ ok: false, reason: "malformed_key" });
    expect(readKeyFromHash(`#k=${"z".repeat(64)}`)).toEqual({ ok: false, reason: "malformed_key" });
  });
});

describe("claim page state", () => {
  it("is claimable for a funded transfer with the right key", () => {
    expect(deriveClaimState(base)).toEqual({ kind: "claimable" });
    expect(deriveClaimState({ ...base, chain: chain() })).toEqual({ kind: "claimable" });
  });
  it("is invalid when the key's signer doesn't match (chain wins over API)", () => {
    expect(deriveClaimState({ ...base, info: info({ claimSigner: other.claimSigner.toLowerCase() }) })).toEqual({ kind: "invalid", reason: "wrong_key" });
    expect(deriveClaimState({ ...base, chain: chain({ claimSigner: other.claimSigner }) })).toEqual({ kind: "invalid", reason: "wrong_key" });
  });
  it("reports missing keys before anything else", () => {
    expect(deriveClaimState({ ...base, key: { ok: false, reason: "missing_key" } })).toEqual({ kind: "invalid", reason: "missing_key" });
  });
  it("detects expiry from chain time even if the API still says awaiting_claim", () => {
    expect(deriveClaimState({ ...base, chain: chain({ expiresAt: NOW - 1 }) })).toEqual({ kind: "expired" });
    expect(deriveClaimState({ ...base, info: info({ expiresAt: new Date((NOW - 5) * 1000).toISOString() }) })).toEqual({ kind: "expired" });
  });
  it("shows already claimed with who and the tx", () => {
    const s = deriveClaimState({ ...base, info: info({ status: "claimed", claimedBy: "0xbeef", settlementTxHash: "0xfeed" }) });
    expect(s).toEqual({ kind: "claimed", claimedBy: "0xbeef", txHash: "0xfeed" });
    const c = deriveClaimState({ ...base, chain: chain({ status: "claimed", recipient: "0xcafe" }) });
    expect(c).toMatchObject({ kind: "claimed", claimedBy: "0xcafe" });
  });
  it("shows cancelled, refunded and not-yet-funded", () => {
    expect(deriveClaimState({ ...base, info: info({ status: "cancelled" }) }).kind).toBe("cancelled");
    expect(deriveClaimState({ ...base, chain: chain({ status: "refunded" }) }).kind).toBe("refunded");
    expect(deriveClaimState({ ...base, info: info({ status: "awaiting_funding", chainTransferId: null }) }).kind).toBe("not_funded");
    expect(deriveClaimState({ ...base, info: info({ status: "claim_submitted" }) }).kind).toBe("claim_pending");
  });
  it("falls back to the chain when the API is down, and says so when both are", () => {
    expect(deriveClaimState({ ...base, info: undefined, chain: chain() })).toEqual({ kind: "claimable" });
    expect(deriveClaimState({ ...base, info: undefined, chain: null })).toEqual({ kind: "unavailable" });
    expect(deriveClaimState({ ...base, info: undefined, infoNotFound: true })).toEqual({ kind: "invalid", reason: "not_found" });
    expect(deriveClaimState({ ...base, info: undefined, infoLoading: true })).toEqual({ kind: "loading" });
  });
});
