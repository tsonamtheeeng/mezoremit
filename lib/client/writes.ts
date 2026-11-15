import type { Abi, Address, Hash, Hex, TransactionReceipt } from "viem";
import type { Config } from "wagmi";
import { getAccount, readContract, signTypedData, simulateContract, waitForTransactionReceipt, writeContract } from "@wagmi/core";
import { erc20Abi, remittanceManagerAbi } from "@/lib/chain/abis";
import { contracts, isDeployed, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { assertChain } from "./guard";
import { permitDeadline, permitTypedData, splitPermitSignature } from "./permit";
import { isPermitUnsupported } from "./errors";
import { isSmartAccountConnector } from "./smart-account";

/** A single contract write described as data, so it can be previewed, simulated and tested. */
export interface WriteSpec {
  label: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

const M = () => contracts.manager;
const mgr = remittanceManagerAbi as Abi;

export const build = {
  approveMusd: (amount: bigint): WriteSpec => ({
    label: "Allow MezoRemit to send this MUSD",
    address: contracts.musd,
    abi: erc20Abi as Abi,
    functionName: "approve",
    args: [M(), amount],
  }),
  sendDirect: (recipient: Address, amount: bigint, ref: Hex): WriteSpec => ({
    label: "Send MUSD",
    address: M(),
    abi: mgr,
    functionName: "sendDirect",
    args: [recipient, amount, ref],
  }),
  sendDirectWithPermit: (recipient: Address, amount: bigint, ref: Hex, deadline: bigint, v: number, r: Hex, s: Hex): WriteSpec => ({
    label: "Send MUSD",
    address: M(),
    abi: mgr,
    functionName: "sendDirectWithPermit",
    args: [recipient, amount, ref, deadline, v, r, s],
  }),
  createClaimable: (claimSigner: Address, amount: bigint, expiresAt: bigint, ref: Hex): WriteSpec => ({
    label: "Lock MUSD for the claim link",
    address: M(),
    abi: mgr,
    functionName: "createClaimable",
    args: [claimSigner, amount, expiresAt, ref],
  }),
  createClaimableWithPermit: (claimSigner: Address, amount: bigint, expiresAt: bigint, ref: Hex, deadline: bigint, v: number, r: Hex, s: Hex): WriteSpec => ({
    label: "Lock MUSD for the claim link",
    address: M(),
    abi: mgr,
    functionName: "createClaimableWithPermit",
    args: [claimSigner, amount, expiresAt, ref, deadline, v, r, s],
  }),
  claimTransfer: (transferId: bigint, recipient: Address, signature: Hex): WriteSpec => ({
    label: "Claim MUSD",
    address: M(),
    abi: mgr,
    functionName: "claimTransfer",
    args: [transferId, recipient, signature],
  }),
  cancelTransfer: (transferId: bigint): WriteSpec => ({
    label: "Cancel transfer",
    address: M(),
    abi: mgr,
    functionName: "cancelTransfer",
    args: [transferId],
  }),
  refundExpiredTransfer: (transferId: bigint): WriteSpec => ({
    label: "Refund expired transfer",
    address: M(),
    abi: mgr,
    functionName: "refundExpiredTransfer",
    args: [transferId],
  }),
};

export class NotDeployedError extends Error {
  constructor() {
    super("MezoRemit isn't deployed on Mezo Testnet yet, so transfers are turned off.");
    this.name = "NotDeployedError";
  }
}

export interface WriteHooks {
  onWallet?: (label: string, ask: "signature" | "transaction" | "none") => void;
  onSubmitted?: (label: string, hash: Hash) => void;
}

/** Checks deployment + chain, simulates (so reverts surface before the wallet prompt), sends, waits. */
export async function executeWrite(config: Config, s: WriteSpec, hooks: WriteHooks = {}): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
  if (!isDeployed) throw new NotDeployedError();
  const conn = getAccount(config);
  if (!conn.address) throw new Error("Wallet not connected");
  assertChain(conn.chainId, MEZO_TESTNET_ID);
  const { request } = await simulateContract(config, {
    address: s.address,
    abi: s.abi,
    functionName: s.functionName,
    args: s.args,
    account: conn.address,
    chainId: MEZO_TESTNET_ID,
  } as Parameters<typeof simulateContract>[1]);
  assertChain(getAccount(config).chainId, MEZO_TESTNET_ID);
  hooks.onWallet?.(s.label, "transaction");
  const hash = await writeContract(config, request as Parameters<typeof writeContract>[1]);
  hooks.onSubmitted?.(s.label, hash);
  const receipt = await waitForTransactionReceipt(config, { hash, chainId: MEZO_TESTNET_ID, timeout: 180_000 });
  if (receipt.status !== "success") {
    const err = new Error("The transaction was reverted on-chain.") as Error & { hash: Hash };
    err.hash = hash;
    throw err;
  }
  return { hash, receipt };
}

export type FundingPlan =
  | { kind: "direct"; recipient: Address; amount: bigint; ref: Hex }
  | { kind: "claim"; claimSigner: Address; amount: bigint; expiresAt: bigint; ref: Hex };

/**
 * Funding path chooser. Pure, so it is unit tested.
 * enough allowance → plain call; otherwise permit (one signature + one tx), falling back to approve + call.
 * Mezo Passport Bitcoin wallets act through a smart account, which can't produce the ECDSA signature MUSD's
 * permit checks, so they go straight to approve + call.
 */
export function fundingPath(allowance: bigint | null, amount: bigint, smartAccount = false): "plain" | "permit" | "approve" {
  if (allowance !== null && allowance >= amount) return "plain";
  return smartAccount ? "approve" : "permit";
}

function plainSpec(p: FundingPlan): WriteSpec {
  return p.kind === "direct" ? build.sendDirect(p.recipient, p.amount, p.ref) : build.createClaimable(p.claimSigner, p.amount, p.expiresAt, p.ref);
}

/**
 * Sends the funding transaction: prefers an EIP-2612 permit (sign once, one transaction),
 * falls back to approve + call when the wallet or token can't do permits.
 */
export async function fundTransfer(config: Config, p: FundingPlan, hooks: WriteHooks & { onStep?: (step: string) => void } = {}) {
  if (!isDeployed) throw new NotDeployedError();
  const conn = getAccount(config);
  if (!conn.address) throw new Error("Wallet not connected");
  assertChain(conn.chainId, MEZO_TESTNET_ID);
  const owner = conn.address;

  const allowance = await readContract(config, {
    address: contracts.musd,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, contracts.manager],
    chainId: MEZO_TESTNET_ID,
  }).catch(() => null);

  const path = fundingPath(allowance as bigint | null, p.amount, isSmartAccountConnector(conn.connector));
  if (path === "plain") return executeWrite(config, plainSpec(p), hooks);

  // Permit path (skipped for smart accounts)
  let permitted: { deadline: bigint; v: number; r: Hex; s: Hex } | null = null;
  if (path === "permit") {
    try {
      const nonce = (await readContract(config, {
        address: contracts.musd,
        abi: erc20Abi,
        functionName: "nonces",
        args: [owner],
        chainId: MEZO_TESTNET_ID,
      })) as bigint;
      const deadline = permitDeadline();
      hooks.onWallet?.("Approve this amount (free signature)", "signature");
      const sig = await signTypedData(config, permitTypedData({ token: contracts.musd, owner, spender: contracts.manager, value: p.amount, nonce, deadline }));
      permitted = { deadline, ...splitPermitSignature(sig) };
    } catch (err) {
      if (!isPermitUnsupported(err)) throw err;
      permitted = null;
    }
  }

  if (permitted) {
    const spec =
      p.kind === "direct"
        ? build.sendDirectWithPermit(p.recipient, p.amount, p.ref, permitted.deadline, permitted.v, permitted.r, permitted.s)
        : build.createClaimableWithPermit(p.claimSigner, p.amount, p.expiresAt, p.ref, permitted.deadline, permitted.v, permitted.r, permitted.s);
    try {
      return await executeWrite(config, spec, hooks);
    } catch (err) {
      // Simulation failed on the permit itself → fall back. Anything already sent (has hash) or rejected bubbles up.
      if ((err as { hash?: Hash }).hash || !isPermitUnsupported(err)) throw err;
      const msg = String((err as Error)?.message ?? "");
      if (!/permit|ERC2612|signature|InvalidSigner|allowance/i.test(msg)) throw err;
    }
  }

  hooks.onStep?.("Step 1 of 2");
  await executeWrite(config, build.approveMusd(p.amount), hooks);
  hooks.onStep?.("Step 2 of 2");
  return executeWrite(config, plainSpec(p), hooks);
}
