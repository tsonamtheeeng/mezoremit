import { encodeAbiParameters, encodeEventTopics, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { remittanceManagerAbi } from "@/lib/chain/abis";
import { contracts } from "@/lib/chain/config";
import type { ChainAdapter, ChainBlock, ChainTransfer, RawLog, RawReceipt, RelayerAdapter } from "@/lib/server/chain";

export const MANAGER = contracts.manager;
export const E18 = 10n ** 18n;

// Deterministic test wallets.
export const SENDER_KEY = "0x" + "a1".repeat(32);
export const RECIPIENT_KEY = "0x" + "b2".repeat(32);
export const STRANGER_KEY = "0x" + "c3".repeat(32);
export const SENDER = privateKeyToAccount(SENDER_KEY as Hex).address.toLowerCase() as Address;
export const RECIPIENT = privateKeyToAccount(RECIPIENT_KEY as Hex).address.toLowerCase() as Address;
export const STRANGER = privateKeyToAccount(STRANGER_KEY as Hex).address.toLowerCase() as Address;
export const RELAYER = "0xcccc00000000000000000000000000000000cccc" as Address;

let txCounter = 0;
export const txHash = (label = ""): Hex => keccak256(toHex(`tx-${label}-${++txCounter}`));

type AnyAbi = readonly { type: string; name?: string; inputs?: readonly { name: string; type: string; indexed?: boolean }[] }[];

export function blockHashOf(n: bigint, fork: number): Hex {
  return keccak256(toHex(`block-${n}-${fork}`));
}

/** A raw log exactly as an RPC returns it (ABI-encoded topics + data). */
export function rawLog(
  eventName: string,
  args: Record<string, unknown>,
  meta: { blockNumber: bigint; txHash: Hex; logIndex?: number; address?: Address; fork?: number },
): RawLog {
  const abi = remittanceManagerAbi as unknown as AnyAbi;
  const ev = abi.find((x) => x.type === "event" && x.name === eventName);
  if (!ev) throw new Error(`no event ${eventName}`);
  const indexedArgs: Record<string, unknown> = {};
  for (const i of ev.inputs!) if (i.indexed) indexedArgs[i.name] = args[i.name];
  const topics = (encodeEventTopics as unknown as (a: unknown) => Hex[])({ abi, eventName, args: indexedArgs });
  const nonIndexed = ev.inputs!.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed as never, nonIndexed.map((i) => args[i.name]) as never);
  return {
    address: meta.address ?? MANAGER,
    topics,
    data,
    blockNumber: meta.blockNumber,
    blockHash: blockHashOf(meta.blockNumber, meta.fork ?? 0),
    transactionHash: meta.txHash,
    logIndex: meta.logIndex ?? 0,
  };
}

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export function emptyTransfer(): ChainTransfer {
  return {
    sender: ZERO,
    kind: "none",
    status: "none",
    createdAt: 0n,
    expiresAt: 0n,
    settledAt: 0n,
    recipient: ZERO,
    claimSigner: ZERO,
    amount: 0n,
    ref: ("0x" + "00".repeat(32)) as Hex,
  };
}

/** In-memory chain. Tests mutate its maps directly. */
export class FakeChain implements ChainAdapter {
  head = 100n;
  fork = new Map<bigint, number>(); // block → fork salt (reorg simulation)
  logs: RawLog[] = [];
  receipts = new Map<string, RawReceipt>();
  transfers = new Map<bigint, ChainTransfer>();
  claimable = new Map<bigint, boolean>();
  balances = new Map<string, bigint>();
  native = new Map<string, bigint>();
  gasPrice = 1_000_000_000n;
  failing = new Set<string>();
  calls: string[] = [];
  baseTime = 1_900_000_000n;

  private maybeFail(m: string) {
    this.calls.push(m);
    if (this.failing.has(m)) {
      const e = new Error(`HTTP request failed (${m})`);
      e.name = "HttpRequestError";
      throw e;
    }
  }
  async chainId() {
    this.maybeFail("chainId");
    return 31611;
  }
  async getBlockNumber() {
    this.maybeFail("getBlockNumber");
    return this.head;
  }
  blockTime(n: bigint) {
    return this.baseTime + n * 5n;
  }
  async getBlock(n: bigint): Promise<ChainBlock> {
    this.maybeFail("getBlock");
    return { number: n, hash: blockHashOf(n, this.fork.get(n) ?? 0), timestamp: this.blockTime(n) };
  }
  async getLogs({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) {
    this.maybeFail("getLogs");
    if (toBlock - fromBlock + 1n > 2000n) throw new Error("range too large");
    return this.logs
      .filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock)
      .map((l) => ({ ...l, blockHash: blockHashOf(l.blockNumber, this.fork.get(l.blockNumber) ?? 0) }));
  }
  async getReceipt(hash: Hex) {
    this.maybeFail("getReceipt");
    return this.receipts.get(hash.toLowerCase()) ?? null;
  }
  async getTransfer(id: bigint) {
    this.maybeFail("getTransfer");
    return { ...(this.transfers.get(id) ?? emptyTransfer()) };
  }
  async transferIdByRef(sender: Address, ref: Hex) {
    this.maybeFail("transferIdByRef");
    for (const [id, t] of this.transfers)
      if (t.ref.toLowerCase() === ref.toLowerCase() && t.sender.toLowerCase() === sender.toLowerCase()) return id;
    return 0n;
  }
  async isClaimable(id: bigint) {
    this.maybeFail("isClaimable");
    return this.claimable.get(id) ?? false;
  }
  async musdBalanceOf(a: Address) {
    this.maybeFail("musdBalanceOf");
    return this.balances.get(a.toLowerCase()) ?? 0n;
  }
  async nativeBalanceOf(a: Address) {
    this.maybeFail("nativeBalanceOf");
    return this.native.get(a.toLowerCase()) ?? 0n;
  }
  async getGasPrice() {
    return this.gasPrice;
  }
  async verifySmartSignature() {
    return false;
  }

  /** Add a successful (or reverted) receipt; its logs also go into the log index. */
  addTx(hash: Hex, logs: RawLog[], opts: { to?: Address | null; from?: Address; status?: "success" | "reverted"; blockNumber?: bigint } = {}) {
    const bn = opts.blockNumber ?? logs[0]?.blockNumber ?? this.head;
    const r: RawReceipt = {
      status: opts.status ?? "success",
      to: opts.to === undefined ? MANAGER : opts.to,
      from: opts.from ?? SENDER,
      blockNumber: bn,
      blockHash: blockHashOf(bn, this.fork.get(bn) ?? 0),
      transactionHash: hash,
      logs: opts.status === "reverted" ? [] : logs,
    };
    this.receipts.set(hash.toLowerCase(), r);
    if (r.status === "success") this.logs.push(...logs);
    return r;
  }
}

export class FakeRelayer implements RelayerAdapter {
  address = RELAYER;
  simulated: unknown[] = [];
  sent: unknown[] = [];
  simulateError: Error | null = null;
  async simulateClaim(id: bigint, recipient: Address, sig: Hex) {
    this.simulated.push({ id, recipient, sig });
    if (this.simulateError) throw this.simulateError;
  }
  async sendClaim(id: bigint, recipient: Address, sig: Hex) {
    this.sent.push({ id, recipient, sig });
    return txHash("relay");
  }
}

/** Session cookie header for an address (inserts the user + session rows). */
export async function sessionFor(address: string): Promise<{ cookie: string; userId: string; session: { id: string; userId: string; address: string; expiresAt: Date } }> {
  const { getDb } = await import("@/lib/server/db");
  const { ensureUser } = await import("@/lib/server/users");
  const { signSessionId, SESSION_COOKIE } = await import("@/lib/server/auth");
  const { randomBytes } = await import("node:crypto");
  const { clock } = await import("@/lib/server/clock");
  const sql = await getDb();
  const { id: userId } = await ensureUser(sql, address);
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(clock.now().getTime() + 3600_000);
  await sql`INSERT INTO sessions (id, user_id, address, expires_at) VALUES (${id}, ${userId}, ${address.toLowerCase()}, ${expiresAt})`;
  return { cookie: `${SESSION_COOKIE}=${signSessionId(id)}`, userId, session: { id, userId, address: address.toLowerCase(), expiresAt } };
}

export function req(url: string, init: RequestInit & { cookie?: string; json?: unknown } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  headers.set("host", "localhost:3000");
  return new Request(`http://localhost:3000${url}`, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
