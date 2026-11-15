import { parseSignature, type Address, type Hex } from "viem";
import { MEZO_TESTNET_ID, MUSD_PERMIT_DOMAIN } from "@/lib/chain/config";

/** EIP-2612 typed data for MUSD on Mezo Testnet (domain "Mezo USD" / "1"). */
export function permitTypedData(args: { token: Address; owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint }) {
  return {
    domain: { name: MUSD_PERMIT_DOMAIN.name, version: MUSD_PERMIT_DOMAIN.version, chainId: MEZO_TESTNET_ID, verifyingContract: args.token },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit" as const,
    message: { owner: args.owner, spender: args.spender, value: args.value, nonce: args.nonce, deadline: args.deadline },
  };
}

/** Split a 65-byte signature into v/r/s for the *WithPermit calls. */
export function splitPermitSignature(sig: Hex): { v: number; r: Hex; s: Hex } {
  const p = parseSignature(sig);
  const v = p.v !== undefined ? Number(p.v) : (p.yParity ?? 0) + 27;
  return { v: v < 27 ? v + 27 : v, r: p.r, s: p.s };
}

/** Permit deadline: 30 minutes from now (unix seconds). */
export function permitDeadline(nowMs: number = Date.now(), minutes = 30): bigint {
  return BigInt(Math.floor(nowMs / 1000) + minutes * 60);
}
