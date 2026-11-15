// Generates the cross-language EIP-712 test vector used by contracts/test/TsCompat.t.sol.
// Run from repo root:  node_modules/.bin/tsx contracts/test/fixtures/gen-claim-vector.mts
// Uses the FROZEN lib/chain/claim.ts exactly as the browser does.
import { hashTypedData, type Address, type Hex } from "viem";
import { claimDomain, claimSignerOf, claimTypes, signClaim, transferRef } from "../../../lib/chain/claim.ts";

const claimKey: Hex = "0x1111111111111111111111111111111111111111111111111111111111111111";
const manager: Address = "0x1000000000000000000000000000000000000001";
const recipient: Address = "0x000000000000000000000000000000000000bEEF";
const transferId = 1n;
const uuid = "3f2b8c1e-6a4d-4e2f-9b7a-0c5d1e2f3a4b";

const signature = await signClaim(claimKey, manager, transferId, recipient);
const digest = hashTypedData({ domain: claimDomain(manager), types: claimTypes, primaryType: "Claim", message: { transferId, recipient } });
console.log(JSON.stringify({ claimKey, claimSigner: claimSignerOf(claimKey), manager, recipient, transferId: transferId.toString(), digest, signature, uuid, ref: transferRef(uuid) }, null, 2));
