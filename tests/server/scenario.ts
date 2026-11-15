import type { Address, Hex } from "viem";
import { newClaimKey } from "@/lib/chain/claim";
import type { Transfer } from "@/lib/api-types";
import type { Sql } from "@/lib/server/db";
import type { Session } from "@/lib/server/auth";
import { clock } from "@/lib/server/clock";
import { createTransfer } from "@/lib/server/transfers";
import { E18, FakeChain, RECIPIENT, rawLog, txHash } from "./fakes";

/** Wall clock used by every test: block times of the fake chain sit just before it. */
export const T0 = new Date(1_900_000_000_000 + 3_600_000);
export const nowSec = () => Math.floor(clock.now().getTime() / 1000);

let n = 0;
export async function claimTransfer(sql: Sql, s: Session, over: Record<string, unknown> = {}) {
  const key = newClaimKey();
  const transfer = await createTransfer(sql, s, {
    method: "claim",
    amount: (25n * E18).toString(),
    destinationCountry: "MX",
    claimSigner: key.claimSigner,
    expiresAt: nowSec() + 86400,
    note: "Para la renta",
    idempotencyKey: `claim-${++n}`,
    ...over,
  });
  return { transfer, key };
}

export async function directTransfer(sql: Sql, s: Session, over: Record<string, unknown> = {}) {
  return createTransfer(sql, s, {
    method: "direct",
    amount: (10n * E18).toString(),
    destinationCountry: "US",
    recipientWallet: RECIPIENT,
    idempotencyKey: `direct-${++n}`,
    ...over,
  });
}

/** Put a ClaimableCreated on the fake chain (state + log + receipt). */
export function fundClaimOnChain(
  chain: FakeChain,
  t: Transfer,
  o: { chainId?: bigint; block?: bigint; sender?: Address; amount?: bigint; claimSigner?: Address; address?: Address } = {},
) {
  const chainId = o.chainId ?? 1n;
  const block = o.block ?? 10n;
  const hash = txHash("fund");
  const expiresAt = BigInt(Math.floor(new Date(t.expiresAt!).getTime() / 1000));
  const sender = (o.sender ?? t.senderAddress) as Address;
  const amount = o.amount ?? BigInt(t.amount);
  const claimSigner = (o.claimSigner ?? t.claimSigner) as Address;
  const log = rawLog(
    "ClaimableCreated",
    { transferId: chainId, sender, claimSigner, amount, expiresAt, ref: t.ref as Hex },
    { blockNumber: block, txHash: hash, address: o.address },
  );
  chain.addTx(hash, [log], { from: sender, to: o.address });
  if (!o.address) {
    chain.transfers.set(chainId, {
      sender,
      kind: "claimable",
      status: "funded",
      createdAt: chain.blockTime(block),
      expiresAt,
      settledAt: 0n,
      recipient: "0x0000000000000000000000000000000000000000",
      claimSigner,
      amount,
      ref: t.ref as Hex,
    });
    chain.claimable.set(chainId, true);
  }
  return { hash, log, chainId };
}

export function fundDirectOnChain(chain: FakeChain, t: Transfer, o: { chainId?: bigint; block?: bigint; recipient?: Address; amount?: bigint } = {}) {
  const chainId = o.chainId ?? 1n;
  const block = o.block ?? 10n;
  const hash = txHash("direct");
  const recipient = (o.recipient ?? t.recipient!.walletAddress) as Address;
  const amount = o.amount ?? BigInt(t.amount);
  const log = rawLog("DirectTransferSent", { transferId: chainId, sender: t.senderAddress, recipient, amount, ref: t.ref as Hex }, { blockNumber: block, txHash: hash });
  chain.addTx(hash, [log]);
  chain.transfers.set(chainId, {
    sender: t.senderAddress as Address,
    kind: "direct",
    status: "completed",
    createdAt: chain.blockTime(block),
    expiresAt: 0n,
    settledAt: chain.blockTime(block),
    recipient,
    claimSigner: "0x0000000000000000000000000000000000000000",
    amount,
    ref: t.ref as Hex,
  });
  return { hash, log, chainId };
}

export function claimOnChain(chain: FakeChain, chainId: bigint, recipient: Address, submitter: Address, block = 20n) {
  const hash = txHash("claim");
  const ct = chain.transfers.get(chainId)!;
  const log = rawLog("TransferClaimed", { transferId: chainId, recipient, amount: ct.amount, submitter }, { blockNumber: block, txHash: hash });
  chain.addTx(hash, [log], { from: submitter });
  chain.transfers.set(chainId, { ...ct, status: "claimed", recipient, settledAt: chain.blockTime(block) });
  chain.claimable.set(chainId, false);
  return { hash, log };
}
