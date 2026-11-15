// Full two-wallet MezoRemit demo on Mezo Testnet (chain 31611), driven through the real API + real chain.
//
//   SENDER_PRIVATE_KEY=0x… RECIPIENT_PRIVATE_KEY=0x… API_BASE_URL=https://<app> npm run demo:testnet
//
// Needs: NEXT_PUBLIC_MANAGER_ADDRESS (+ NEXT_PUBLIC_DEPLOY_BLOCK) of the deployed RemittanceManager, the web app
// running at API_BASE_URL (and ideally the worker), the sender holding ≥ 55 MUSD + a little BTC for gas. The
// recipient needs BTC only if the gas relay is unavailable.
//
// Steps: sign in both wallets (SIWE) → recipient + quote → 25 MUSD claim transfer (approve + createClaimable) →
// awaiting_claim → recipient opens the link (public info + view proof) → signs Claim with the claim key → relay
// (or wallet B) → claimed → wallet B balance delta == exactly 25 MUSD → duplicate claim reverts → second claim
// transfer with the shortest allowed expiry → wait → refundExpiredTransfer → sender refund verified → one direct
// transfer. Prints explorer links and writes docs/demo-run.json.
//
// This script spends testnet gas. It is NOT run by CI or tests.

import "../worker/load-env";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, http, type Address, type Hex, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  ClaimInfo,
  ClaimViewResponse,
  MeResponse,
  NonceResponse,
  QuoteResponse,
  RecipientDashboard,
  RelayClaimResponse,
  Transfer,
  TransferResponse,
} from "@/lib/api-types";
import { erc20Abi, remittanceManagerAbi } from "@/lib/chain/abis";
import { newClaimKey, signClaim, signViewProof, transferRef } from "@/lib/chain/claim";
import { contracts, explorerTx, isDeployed, MANAGER_LIMITS, mezoTestnet } from "@/lib/chain/config";

const E18 = 10n ** 18n;
const CLAIM_AMOUNT = 25n * E18;
const DIRECT_AMOUNT = 5n * E18;
const API = (process.env.API_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
const RPC = process.env.NEXT_PUBLIC_MEZO_RPC_URL || mezoTestnet.rpcUrls.default.http[0];

type Step = { name: string; ok: boolean; detail?: unknown; txHash?: string; explorer?: string };
const report: {
  startedAt: string;
  finishedAt?: string;
  api: string;
  chainId: number;
  manager: string;
  musd: string;
  sender: string;
  recipient: string;
  ok: boolean;
  steps: Step[];
  error?: string;
} = {
  startedAt: new Date().toISOString(),
  api: API,
  chainId: mezoTestnet.id,
  manager: contracts.manager,
  musd: contracts.musd,
  sender: "",
  recipient: "",
  ok: false,
  steps: [],
};

function step(name: string, ok: boolean, extra: Omit<Step, "name" | "ok"> = {}) {
  const s: Step = { name, ok, ...extra, ...(extra.txHash ? { explorer: explorerTx(extra.txHash) } : {}) };
  report.steps.push(s);
  console.log(`${ok ? "✔" : "✘"} ${name}${s.txHash ? `  ${s.explorer}` : ""}${s.detail !== undefined ? `  ${JSON.stringify(s.detail, big)}` : ""}`);
  if (!ok) throw new Error(`step failed: ${name}`);
}
const big = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function key(name: string): Hex {
  const v = (process.env[name] || "").trim();
  const hex = (v.startsWith("0x") ? v : `0x${v}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${name} must be a 32-byte hex private key`);
  return hex;
}

// ---------------------------------------------------------------- API client with a per-wallet cookie jar

class Api {
  cookie = "";
  constructor(readonly label: string) {}
  async call<T>(method: string, p: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(`${API}${p}`, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data: data as T };
  }
  async ok<T>(method: string, p: string, body?: unknown): Promise<T> {
    const r = await this.call<T>(method, p, body);
    if (r.status < 200 || r.status >= 300) throw new Error(`${this.label} ${method} ${p} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
}

async function signIn(api: Api, account: PrivateKeyAccount): Promise<MeResponse> {
  const { message } = await api.ok<NonceResponse>("POST", "/api/auth/nonce", { address: account.address });
  const signature = await account.signMessage({ message });
  return api.ok<MeResponse>("POST", "/api/auth/verify", { address: account.address, message, signature });
}

async function pollTransfer(api: Api, id: string, want: Transfer["status"][], timeoutMs = 240_000): Promise<Transfer> {
  const end = Date.now() + timeoutMs;
  let last: Transfer | null = null;
  while (Date.now() < end) {
    const r = await api.call<TransferResponse>("POST", `/api/transfers/${id}/confirm`);
    if (r.status === 200) last = r.data.transfer;
    if (last && want.includes(last.status)) return last;
    if (last?.status === "failed") throw new Error(`transfer ${id} failed: ${JSON.stringify(last.timeline.at(-1))}`);
    await sleep(4000);
  }
  throw new Error(`timeout waiting for ${want.join("|")} on ${id} (last: ${last?.status ?? "none"})`);
}

async function pollClaim(api: Api, id: string, want: ClaimInfo["status"][], timeoutMs = 240_000): Promise<ClaimInfo> {
  const end = Date.now() + timeoutMs;
  let last: ClaimInfo | null = null;
  while (Date.now() < end) {
    last = await api.ok<ClaimInfo>("GET", `/api/claims/${id}`);
    if (want.includes(last.status)) return last;
    await sleep(4000);
  }
  throw new Error(`timeout waiting for claim ${id} → ${want.join("|")} (last: ${last?.status ?? "none"})`);
}

// ---------------------------------------------------------------- main

async function main() {
  if (!isDeployed) throw new Error("NEXT_PUBLIC_MANAGER_ADDRESS is not set (deploy RemittanceManager first)");
  const sender = privateKeyToAccount(key("SENDER_PRIVATE_KEY"));
  const recipient = privateKeyToAccount(key("RECIPIENT_PRIVATE_KEY"));
  if (sender.address.toLowerCase() === recipient.address.toLowerCase()) throw new Error("use two different wallets");
  report.sender = sender.address;
  report.recipient = recipient.address;

  const pub = createPublicClient({ chain: mezoTestnet, transport: http(RPC, { retryCount: 3, timeout: 30_000 }) });
  const walletA = createWalletClient({ account: sender, chain: mezoTestnet, transport: http(RPC) });
  const walletB = createWalletClient({ account: recipient, chain: mezoTestnet, transport: http(RPC) });
  const musdBal = (a: Address) => pub.readContract({ address: contracts.musd, abi: erc20Abi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
  const wait = async (hash: Hex) => {
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (r.status !== "success") throw new Error(`tx reverted: ${explorerTx(hash)}`);
    return r;
  };
  const chainNow = async () => Number((await pub.getBlock()).timestamp);

  // ---- preflight
  const chainId = await pub.getChainId();
  step("rpc is Mezo Testnet", chainId === mezoTestnet.id, { detail: { chainId } });
  const [musdA, btcA, btcB] = await Promise.all([musdBal(sender.address), pub.getBalance({ address: sender.address }), pub.getBalance({ address: recipient.address })]);
  const need = CLAIM_AMOUNT * 2n + DIRECT_AMOUNT;
  step("sender holds enough MUSD and BTC", musdA >= need && btcA > 0n, { detail: { musd: musdA, need, btc: btcA } });
  const health = await new Api("anon").ok<{ ok: boolean; deployed: boolean; relayer: { enabled: boolean } }>("GET", "/api/health");
  step("API health", health.ok && health.deployed, { detail: health });

  // ---- sign in both wallets
  const A = new Api("sender");
  const B = new Api("recipient");
  const meA = await signIn(A, sender);
  const meB = await signIn(B, recipient);
  step("SIWE sign-in (both wallets)", meA.user?.address === sender.address.toLowerCase() && meB.user?.address === recipient.address.toLowerCase());

  // ---- recipient + quote
  const { recipient: rec } = await A.ok<{ recipient: { id: string } }>("POST", "/api/recipients", {
    displayName: "Demo Recipient",
    country: "MX",
    walletAddress: recipient.address,
    preferredDeliveryMethod: "claim_link",
    contactReference: "demo contact (encrypted at rest)",
  });
  step("recipient created", Boolean(rec.id), { detail: { id: rec.id } });
  const q = await A.call<QuoteResponse>("POST", "/api/quotes", { amount: CLAIM_AMOUNT.toString(), destinationCountry: "MX", deliveryMethod: "claim_link" });
  const quoteId = q.status === 200 ? q.data.quote.id : null;
  step("indicative quote (or MUSD-only if rates are down)", q.status === 200 || q.status === 503, {
    detail: q.status === 200 ? { referenceRate: q.data.quote.referenceRate, rateSource: q.data.quote.rateSource } : { status: q.status },
  });

  // ---- claim transfer #1 (25 MUSD)
  const k1 = newClaimKey();
  const exp1 = (await chainNow()) + 7 * 86400;
  const { transfer: t1 } = await A.ok<TransferResponse>("POST", "/api/transfers", {
    method: "claim",
    amount: CLAIM_AMOUNT.toString(),
    destinationCountry: "MX",
    recipientId: rec.id,
    claimSigner: k1.claimSigner,
    expiresAt: exp1,
    quoteId,
    note: "Demo note: only visible with the claim link",
    showSenderName: false,
    idempotencyKey: `demo-claim-${Date.now()}`,
  });
  step("claim transfer created", t1.status === "awaiting_funding" && t1.ref === transferRef(t1.id).toLowerCase(), { detail: { id: t1.id } });

  const approve1 = await walletA.writeContract({ address: contracts.musd, abi: erc20Abi, functionName: "approve", args: [contracts.manager, CLAIM_AMOUNT] });
  await wait(approve1);
  step("approve MUSD (claim #1)", true, { txHash: approve1 });
  const fund1 = await walletA.writeContract({
    address: contracts.manager,
    abi: remittanceManagerAbi,
    functionName: "createClaimable",
    args: [k1.claimSigner, CLAIM_AMOUNT, BigInt(exp1), t1.ref as Hex],
  });
  await A.ok<TransferResponse>("POST", `/api/transfers/${t1.id}/submitted`, { txHash: fund1 });
  await wait(fund1);
  step("createClaimable", true, { txHash: fund1 });
  const t1Funded = await pollTransfer(A, t1.id, ["awaiting_claim"]);
  step("status awaiting_claim (verified from chain)", t1Funded.status === "awaiting_claim", { detail: { chainTransferId: t1Funded.chainTransferId } });
  await A.ok<TransferResponse>("POST", `/api/transfers/${t1.id}/shared`, { channel: "copy" });

  // ---- recipient opens the link
  const info = await B.ok<ClaimInfo>("GET", `/api/claims/${t1.id}`);
  const infoText = JSON.stringify(info);
  step("public claim info has no note / names", !infoText.includes("Demo note") && !infoText.includes("Demo Recipient"), { detail: { status: info.status, relayAvailable: info.relayAvailable } });
  const issuedAt = Math.floor(Date.now() / 1000);
  const view = await B.ok<ClaimViewResponse>("POST", `/api/claims/${t1.id}/view`, { issuedAt, signature: await signViewProof(k1.privateKey, t1.id, issuedAt) });
  step("view proof reveals the note", view.note === "Demo note: only visible with the claim link");

  const chainTransferId = BigInt(info.chainTransferId ?? (await pub.readContract({ address: contracts.manager, abi: remittanceManagerAbi, functionName: "transferIdByRef", args: [sender.address, t1.ref as Hex] })));
  const before = await musdBal(recipient.address);
  const claimSig = await signClaim(k1.privateKey, contracts.manager, chainTransferId, recipient.address);
  let claimTx: Hex;
  let via: "relay" | "wallet";
  const relay = info.relayAvailable ? await B.call<RelayClaimResponse>("POST", `/api/claims/${t1.id}/relay`, { recipient: recipient.address, signature: claimSig }) : null;
  if (relay && relay.status === 200) {
    claimTx = relay.data.txHash as Hex;
    via = "relay";
  } else {
    if (btcB === 0n) throw new Error("relay unavailable and the recipient has no BTC for gas");
    claimTx = await walletB.writeContract({
      address: contracts.manager,
      abi: remittanceManagerAbi,
      functionName: "claimTransfer",
      args: [chainTransferId, recipient.address, claimSig],
    });
    await B.ok<ClaimInfo>("POST", `/api/claims/${t1.id}/submitted`, { txHash: claimTx });
    via = "wallet";
  }
  await wait(claimTx);
  step(`claimTransfer (via ${via})`, true, { txHash: claimTx, detail: relay && relay.status !== 200 ? { relayFallbackReason: relay.data } : undefined });
  await pollTransfer(A, t1.id, ["claimed"]);
  const claimed = await pollClaim(B, t1.id, ["claimed"]);
  step("status claimed", claimed.claimedBy === recipient.address.toLowerCase(), { detail: { claimedBy: claimed.claimedBy } });
  const after = await musdBal(recipient.address);
  step("recipient balance delta == exactly 25 MUSD", after - before === CLAIM_AMOUNT, { detail: { before, after, delta: after - before } });

  let dupReverted = false;
  let dupError = "";
  try {
    await pub.simulateContract({
      account: recipient,
      address: contracts.manager,
      abi: remittanceManagerAbi,
      functionName: "claimTransfer",
      args: [chainTransferId, recipient.address, claimSig],
    });
  } catch (e) {
    dupReverted = true;
    dupError = (e as Error).message.split("\n")[0];
  }
  step("duplicate claim reverts", dupReverted, { detail: { error: dupError } });

  // ---- claim transfer #2: shortest allowed expiry, then refund
  const k2 = newClaimKey();
  const exp2 = (await chainNow()) + MANAGER_LIMITS.TESTNET_MIN_EXPIRY + 45; // margin for tx inclusion + clock skew
  const { transfer: t2 } = await A.ok<TransferResponse>("POST", "/api/transfers", {
    method: "claim",
    amount: CLAIM_AMOUNT.toString(),
    destinationCountry: "PH",
    claimSigner: k2.claimSigner,
    expiresAt: exp2,
    idempotencyKey: `demo-expiry-${Date.now()}`,
  });
  const approve2 = await walletA.writeContract({ address: contracts.musd, abi: erc20Abi, functionName: "approve", args: [contracts.manager, CLAIM_AMOUNT] });
  await wait(approve2);
  const fund2 = await walletA.writeContract({
    address: contracts.manager,
    abi: remittanceManagerAbi,
    functionName: "createClaimable",
    args: [k2.claimSigner, CLAIM_AMOUNT, BigInt(exp2), t2.ref as Hex],
  });
  await A.ok<TransferResponse>("POST", `/api/transfers/${t2.id}/submitted`, { txHash: fund2 });
  await wait(fund2);
  step("short-expiry claim funded", true, { txHash: fund2, detail: { expiresAt: new Date(exp2 * 1000).toISOString() } });
  await pollTransfer(A, t2.id, ["awaiting_claim", "expired"]);
  console.log(`  waiting for chain time to pass expiry (${new Date(exp2 * 1000).toISOString()})…`);
  while ((await chainNow()) <= exp2) await sleep(5000);
  const id2 = (await pub.readContract({ address: contracts.manager, abi: remittanceManagerAbi, functionName: "transferIdByRef", args: [sender.address, t2.ref as Hex] })) as bigint;
  const senderBefore = await musdBal(sender.address);
  const refund = await walletA.writeContract({ address: contracts.manager, abi: remittanceManagerAbi, functionName: "refundExpiredTransfer", args: [id2] });
  await wait(refund);
  const senderAfter = await musdBal(sender.address);
  step("refundExpiredTransfer → sender refunded exactly 25 MUSD", senderAfter - senderBefore === CLAIM_AMOUNT, { txHash: refund, detail: { delta: senderAfter - senderBefore } });
  await sleep(1000);
  const t2Final = await (async () => {
    const end = Date.now() + 240_000;
    while (Date.now() < end) {
      const t = (await A.ok<TransferResponse>("GET", `/api/transfers/${t2.id}`)).transfer;
      if (t.status === "refunded") return t;
      await sleep(5000);
    }
    return (await A.ok<TransferResponse>("GET", `/api/transfers/${t2.id}`)).transfer;
  })();
  step("status refunded (from the indexer)", t2Final.status === "refunded", { detail: { status: t2Final.status } });

  // ---- direct transfer
  const { transfer: t3 } = await A.ok<TransferResponse>("POST", "/api/transfers", {
    method: "direct",
    amount: DIRECT_AMOUNT.toString(),
    destinationCountry: "US",
    recipientWallet: recipient.address,
    idempotencyKey: `demo-direct-${Date.now()}`,
  });
  const approve3 = await walletA.writeContract({ address: contracts.musd, abi: erc20Abi, functionName: "approve", args: [contracts.manager, DIRECT_AMOUNT] });
  await wait(approve3);
  const bBefore = await musdBal(recipient.address);
  const send = await walletA.writeContract({ address: contracts.manager, abi: remittanceManagerAbi, functionName: "sendDirect", args: [recipient.address, DIRECT_AMOUNT, t3.ref as Hex] });
  await A.ok<TransferResponse>("POST", `/api/transfers/${t3.id}/submitted`, { txHash: send });
  await wait(send);
  const t3Done = await pollTransfer(A, t3.id, ["completed"]);
  const bAfter = await musdBal(recipient.address);
  step("direct transfer completed, recipient +5 MUSD", t3Done.status === "completed" && bAfter - bBefore === DIRECT_AMOUNT, { txHash: send });

  const dash = await B.ok<RecipientDashboard>("GET", "/api/dashboard/recipient");
  step("recipient dashboard", dash.totals.transfers >= 2, { detail: dash.totals });

  report.ok = true;
}

main()
  .catch((e) => {
    report.error = (e as Error).message;
    console.error("\nDEMO FAILED:", report.error);
    process.exitCode = 1;
  })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    const out = path.join(process.cwd(), "docs/demo-run.json");
    fs.writeFileSync(out, JSON.stringify(report, big, 2) + "\n");
    console.log(`\nreport → ${out}`);
  });
