// Chain service. Every chain access in the backend goes through the small `ChainAdapter` interface so tests can
// inject fakes (setChainForTests). The live adapter is a viem public client on mezoTestnet (NEXT_PUBLIC_MEZO_RPC_URL).
// The gas relayer (optional, RELAYER_PRIVATE_KEY) is a separate `RelayerAdapter`.

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  verifyMessage,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi, remittanceManagerAbi } from "@/lib/chain/abis";
import { CHAIN_KIND, CHAIN_STATUS, contracts, mezoTestnet, type ChainKind, type ChainStatus } from "@/lib/chain/config";
import { env } from "./env";
import { unavailable } from "./errors";

// ---------------------------------------------------------------- types

export interface ChainTransfer {
  sender: Address;
  kind: ChainKind;
  status: ChainStatus;
  createdAt: bigint;
  expiresAt: bigint;
  settledAt: bigint;
  recipient: Address;
  claimSigner: Address;
  amount: bigint;
  ref: Hex;
}

export interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
}

export interface RawReceipt {
  status: "success" | "reverted";
  to: Address | null;
  from: Address;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logs: RawLog[];
}

export interface ChainBlock {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}

export interface ChainAdapter {
  chainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(n: bigint): Promise<ChainBlock>;
  /** Logs of the RemittanceManager in [fromBlock, toBlock]. Callers keep ranges ≤ MAX_LOG_RANGE. */
  getLogs(range: { fromBlock: bigint; toBlock: bigint }): Promise<RawLog[]>;
  getReceipt(hash: Hex): Promise<RawReceipt | null>;
  getTransfer(id: bigint): Promise<ChainTransfer>;
  /** Refs are unique per sender on-chain, so the lookup needs the sender too. */
  transferIdByRef(sender: Address, ref: Hex): Promise<bigint>;
  isClaimable(id: bigint): Promise<boolean>;
  /** MUSD balance (base units). */
  musdBalanceOf(address: Address): Promise<bigint>;
  /** Native BTC balance (wei, 18 dec). */
  nativeBalanceOf(address: Address): Promise<bigint>;
  getGasPrice(): Promise<bigint>;
  /** ERC-1271 / ERC-6492 smart-account signature check (EOA handled locally first). */
  verifySmartSignature(address: Address, message: string, signature: Hex): Promise<boolean>;
}

export interface RelayerAdapter {
  address: Address;
  /** eth_call of claimTransfer from the relayer; throws on revert. */
  simulateClaim(transferId: bigint, recipient: Address, signature: Hex): Promise<void>;
  sendClaim(transferId: bigint, recipient: Address, signature: Hex): Promise<Hex>;
}

export const MAX_LOG_RANGE = 2000n;

// ---------------------------------------------------------------- decoding

export interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>; // bigint values kept as bigint
  blockNumber: bigint;
  blockHash: Hex;
  txHash: Hex;
  logIndex: number;
}

const lc = (a: string | null | undefined) => (a ?? "").toLowerCase();

export function isManagerAddress(address: string | null | undefined): boolean {
  return lc(address) === lc(contracts.manager) && /^0x0{40}$/.test(lc(contracts.manager)) === false;
}

/**
 * Decode a raw log emitted by OUR RemittanceManager. Logs from any other address return null — a lookalike
 * contract emitting identical event signatures is never trusted.
 */
export function decodeLog(log: RawLog): DecodedLog | null {
  if (!isManagerAddress(log.address)) return null;
  try {
    const decoded = decodeEventLog({
      abi: remittanceManagerAbi,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
      strict: true,
    });
    return {
      eventName: decoded.eventName as string,
      args: { ...(decoded.args as unknown as Record<string, unknown>) },
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
    };
  } catch {
    return null;
  }
}

/** Bigint-safe JSON (bigint → decimal string) for blockchain_events.args. */
export function argsToJson(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === "bigint" ? v.toString() : typeof v === "string" ? v.toLowerCase() : v;
  return out;
}

// ---------------------------------------------------------------- live adapter

function asBig(v: unknown): bigint {
  return typeof v === "bigint" ? v : BigInt((v as number | string | undefined) ?? 0);
}

export function parseTransfer(r: Record<string, unknown>): ChainTransfer {
  return {
    sender: r.sender as Address,
    kind: CHAIN_KIND[Number(r.kind ?? 0)] ?? "none",
    status: CHAIN_STATUS[Number(r.status ?? 0)] ?? "none",
    createdAt: asBig(r.createdAt),
    expiresAt: asBig(r.expiresAt),
    settledAt: asBig(r.settledAt),
    recipient: r.recipient as Address,
    claimSigner: r.claimSigner as Address,
    amount: asBig(r.amount),
    ref: r.ref as Hex,
  };
}

function rpcUrl(): string {
  return process.env.NEXT_PUBLIC_MEZO_RPC_URL || mezoTestnet.rpcUrls.default.http[0];
}

let _client: PublicClient | null = null;
export function publicClient(): PublicClient {
  if (!_client) {
    _client = createPublicClient({ chain: mezoTestnet, transport: http(rpcUrl(), { retryCount: 2, timeout: 20_000 }) }) as PublicClient;
  }
  return _client;
}

function toRawLog(l: {
  address: Address;
  topics: readonly Hex[] | Hex[];
  data: Hex;
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  logIndex: number | null;
}): RawLog {
  return {
    address: l.address,
    topics: [...l.topics] as Hex[],
    data: l.data,
    blockNumber: l.blockNumber ?? 0n,
    blockHash: (l.blockHash ?? "0x") as Hex,
    transactionHash: (l.transactionHash ?? "0x") as Hex,
    logIndex: l.logIndex ?? 0,
  };
}

export function createLiveChain(client: PublicClient = publicClient()): ChainAdapter {
  const manager = contracts.manager;
  return {
    chainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber(),
    async getBlock(n) {
      const b = await client.getBlock({ blockNumber: n });
      return { number: b.number ?? n, hash: b.hash as Hex, timestamp: b.timestamp };
    },
    async getLogs({ fromBlock, toBlock }) {
      if (toBlock - fromBlock + 1n > MAX_LOG_RANGE) throw new Error(`getLogs range too large (${fromBlock}-${toBlock})`);
      const logs = await client.getLogs({ address: manager, fromBlock, toBlock });
      return logs.map(toRawLog);
    },
    async getReceipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return {
          status: r.status,
          to: r.to,
          from: r.from,
          blockNumber: r.blockNumber,
          blockHash: r.blockHash,
          transactionHash: r.transactionHash,
          logs: r.logs.map(toRawLog),
        };
      } catch (e) {
        if (e instanceof Error && /could not be found|not found/i.test(e.message)) return null;
        throw e;
      }
    },
    async getTransfer(id) {
      const r = await client.readContract({ address: manager, abi: remittanceManagerAbi, functionName: "getTransfer", args: [id] });
      return parseTransfer(r as unknown as Record<string, unknown>);
    },
    async transferIdByRef(sender, ref) {
      return (await client.readContract({ address: manager, abi: remittanceManagerAbi, functionName: "transferIdByRef", args: [sender, ref] })) as bigint;
    },
    async isClaimable(id) {
      return (await client.readContract({ address: manager, abi: remittanceManagerAbi, functionName: "isClaimable", args: [id] })) as boolean;
    },
    async musdBalanceOf(address) {
      return (await client.readContract({ address: contracts.musd, abi: erc20Abi, functionName: "balanceOf", args: [address] })) as bigint;
    },
    nativeBalanceOf: (address) => client.getBalance({ address }),
    getGasPrice: () => client.getGasPrice(),
    async verifySmartSignature(address, message, signature) {
      try {
        return await client.verifyMessage({ address, message, signature });
      } catch (e) {
        if (isTransientError(e)) throw e; // RPC outage is not a verdict on the signature
        return false;
      }
    },
  };
}

export function createLiveRelayer(privateKey: Hex, client: PublicClient = publicClient()): RelayerAdapter {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(rpcUrl(), { retryCount: 1, timeout: 30_000 }) });
  return {
    address: account.address,
    async simulateClaim(transferId, recipient, signature) {
      await client.simulateContract({
        account,
        address: contracts.manager,
        abi: remittanceManagerAbi,
        functionName: "claimTransfer",
        args: [transferId, recipient, signature],
      });
    },
    async sendClaim(transferId, recipient, signature) {
      // Legacy tx with explicit gas: Mezo's RPC intermittently rejects EIP-1559 fee estimation
      // ("Missing or invalid parameters"), the same reason the deploy uses --legacy. One retry on failure.
      const req = { account, address: contracts.manager, abi: remittanceManagerAbi, functionName: "claimTransfer" as const, args: [transferId, recipient, signature] as const };
      const send = async () => {
        const [gas, gasPrice] = await Promise.all([client.estimateContractGas(req), client.getGasPrice()]);
        return wallet.writeContract({ ...req, gas: (gas * 13n) / 10n, gasPrice, type: "legacy" });
      };
      try {
        return await send();
      } catch {
        await new Promise((r) => setTimeout(r, 1500));
        return send();
      }
    },
  };
}

// ---------------------------------------------------------------- singletons + helpers

let _chain: ChainAdapter | null = null;
export function getChain(): ChainAdapter {
  if (!_chain) _chain = createLiveChain();
  return _chain;
}
export function setChainForTests(c: ChainAdapter | null) {
  _chain = c;
}

let _relayer: RelayerAdapter | null | undefined;
/** null when RELAYER_PRIVATE_KEY is unset or malformed. */
export function getRelayer(): RelayerAdapter | null {
  if (_relayer !== undefined) return _relayer;
  const k = env.relayerPrivateKey();
  const hex = (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  _relayer = /^0x[0-9a-fA-F]{64}$/.test(hex) ? createLiveRelayer(hex) : null;
  return _relayer;
}
export function setRelayerForTests(r: RelayerAdapter | null | undefined) {
  _relayer = r;
}

/** EOA ecrecover first (no network), then ERC-1271/6492 via the RPC for smart accounts. */
export async function verifyWalletSignature(chain: ChainAdapter, address: Address, message: string, signature: Hex): Promise<boolean> {
  try {
    if (await verifyMessage({ address, message, signature })) return true;
  } catch {
    // malformed / non-65-byte signature: fall through to the smart-account check
  }
  try {
    return await chain.verifySmartSignature(address, message, signature);
  } catch (e) {
    if (isTransientError(e)) throw unavailable("chain_unavailable", "Mezo RPC is unreachable right now. Try again shortly.");
    throw e;
  }
}

/** Network / RPC / DB-connection trouble: retry later instead of treating it as a verdict. */
export function isTransientError(e: unknown): boolean {
  for (let c: unknown = e, i = 0; c && i < 6; c = (c as { cause?: unknown }).cause, i++) {
    const err = c as { name?: string; code?: unknown; message?: string };
    if (err.name && /^(HttpRequestError|TimeoutError|RpcRequestError|WebSocketRequestError|SocketClosedError|AbortError)$/.test(err.name)) return true;
    const code = typeof err.code === "string" ? err.code : "";
    if (/^(08|53|57P)/.test(code) || /^CONNECTION_|^ECONN|^ETIMEDOUT|^EPIPE/.test(code)) return true;
    if (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|timed out/i.test(err.message ?? "")) return true;
  }
  return false;
}
