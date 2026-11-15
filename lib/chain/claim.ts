// FROZEN. Claim-key + claim-link helpers shared by the browser (create/claim) and server (view proof).
//
// Claim link format:  {APP_URL}/claim/{appTransferId}#k={claimPrivateKeyHex-without-0x}
// appTransferId is the off-chain uuid. It is known BEFORE the funding tx, so the sender's browser can build the
// link up front; the claim page resolves the on-chain id via RemittanceManager.transferIdByRef(sender, transferRef(uuid))
// (refs are unique per sender; the sender comes from GET /api/claims/{appTransferId}) or via that endpoint's chainTransferId.
// The key lives ONLY in the URL fragment: browsers never send fragments to servers, so it does not reach
// our logs, analytics, or Referer headers. The server never sees or stores the private key.
import { keccak256, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CLAIM_DOMAIN_NAME, CLAIM_DOMAIN_VERSION, MEZO_TESTNET_ID } from "./config";

export const claimTypes = {
  Claim: [
    { name: "transferId", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
} as const;

export function claimDomain(manager: Address) {
  return { name: CLAIM_DOMAIN_NAME, version: CLAIM_DOMAIN_VERSION, chainId: MEZO_TESTNET_ID, verifyingContract: manager } as const;
}

/** Fresh random claim key (CSPRNG via viem/noble). */
export function newClaimKey(): { privateKey: Hex; claimSigner: Address } {
  const privateKey = generatePrivateKey();
  return { privateKey, claimSigner: privateKeyToAccount(privateKey).address };
}

export function claimSignerOf(privateKey: Hex): Address {
  return privateKeyToAccount(privateKey).address;
}

/** Signature submitted to RemittanceManager.claimTransfer. */
export async function signClaim(privateKey: Hex, manager: Address, transferId: bigint, recipient: Address): Promise<Hex> {
  return privateKeyToAccount(privateKey).signTypedData({
    domain: claimDomain(manager),
    types: claimTypes,
    primaryType: "Claim",
    message: { transferId, recipient },
  });
}

/** Off-chain proof of link possession, used to reveal the sender's note on the claim page. Not valid on-chain. */
export function viewProofMessage(appTransferId: string, issuedAtSec: number): string {
  return `MezoRemit claim view\ntransfer:${appTransferId}\nissued:${issuedAtSec}`;
}
export async function signViewProof(privateKey: Hex, appTransferId: string, issuedAtSec: number): Promise<Hex> {
  return privateKeyToAccount(privateKey).signMessage({ message: viewProofMessage(appTransferId, issuedAtSec) });
}

export function buildClaimLink(appUrl: string, appTransferId: string, privateKey: Hex): string {
  return `${appUrl.replace(/\/+$/, "")}/claim/${appTransferId}#k=${privateKey.slice(2)}`;
}

/** Parses `#k=...` from location.hash. Returns null if missing/malformed. */
export function parseClaimFragment(hash: string): Hex | null {
  const m = /(?:^#|&)k=([0-9a-fA-F]{64})(?:&|$)/.exec(hash.startsWith("#") ? hash : `#${hash}`);
  return m ? (`0x${m[1].toLowerCase()}` as Hex) : null;
}

/** On-chain ref for an app transfer uuid. */
export function transferRef(appTransferId: string): Hex {
  return keccak256(toHex(`mezoremit:transfer:${appTransferId}`));
}
