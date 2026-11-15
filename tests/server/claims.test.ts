import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Address, Hex } from "viem";
import { signClaim, signViewProof } from "@/lib/chain/claim";
import { contracts } from "@/lib/chain/config";
import { addSeconds, clock } from "@/lib/server/clock";
import { setChainForTests, setRelayerForTests } from "@/lib/server/chain";
import { resetRelayerCacheForTests } from "@/lib/server/claims";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { runIndexerPass } from "@/lib/server/indexer";
import { createRecipient } from "@/lib/server/recipients";
import { updateSettings } from "@/lib/server/settings";
import { GET as claimGET } from "@/app/api/claims/[id]/route";
import { POST as viewPOST } from "@/app/api/claims/[id]/view/route";
import { POST as relayPOST } from "@/app/api/claims/[id]/relay/route";
import { E18, FakeChain, FakeRelayer, RECIPIENT, RELAYER, SENDER, params, req, sessionFor } from "./fakes";
import { T0, claimTransfer, fundClaimOnChain } from "./scenario";

let sql: Sql;
let chain: FakeChain;
let relayer: FakeRelayer;
const nowSec = () => Math.floor(clock.now().getTime() / 1000);

beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
  chain = new FakeChain();
  relayer = new FakeRelayer();
  chain.native.set(RELAYER.toLowerCase(), E18);
  setChainForTests(chain);
  setRelayerForTests(relayer);
  resetRelayerCacheForTests();
});

async function funded() {
  const a = await sessionFor(SENDER);
  await updateSettings(sql, a.userId, { displayName: "Ana Sender" });
  const rec = await createRecipient(sql, a.userId, {
    displayName: "María Secret",
    country: "MX",
    preferredDeliveryMethod: "claim_link",
    contactReference: "WhatsApp +52 55 0000 1111",
  });
  const { transfer, key } = await claimTransfer(sql, a.session, { recipientId: rec.id, note: "Private note for María", showSenderName: true });
  const { chainId } = fundClaimOnChain(chain, transfer);
  await runIndexerPass(sql, chain, { confirmations: 0 });
  return { a, transfer, key, chainId };
}

const getInfo = async (id: string) => claimGET(req(`/api/claims/${id}`), params({ id }));
const relay = async (id: string, body: unknown, ip = "1.2.3.4") =>
  relayPOST(req(`/api/claims/${id}/relay`, { json: body, headers: { "x-real-ip": ip } }), params({ id }));

describe("public claim info", () => {
  it("confirms a reported funding tx itself, so the free claim shows before the indexer runs", async () => {
    const a = await sessionFor(SENDER);
    const { transfer } = await claimTransfer(sql, a.session);
    const { hash } = fundClaimOnChain(chain, transfer);
    // The sender's client reported the tx; no indexer pass has run.
    await sql`UPDATE transfers SET funding_tx_hash = ${hash.toLowerCase()}, status = 'funding_submitted' WHERE id = ${transfer.id}`;
    const res = await claimGET(req(`/api/claims/${transfer.id}`), params({ id: transfer.id }));
    const body = await res.json();
    expect(body.status).toBe("awaiting_claim");
    expect(body.chainTransferId).toBe("1");
    expect(body.relayAvailable).toBe(true);
  });

  it("contains only on-chain-public data: no note, names, or contact data", async () => {
    const { transfer } = await funded();
    const res = await getInfo(transfer.id);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(
      ["amount", "chainTransferId", "claimSigner", "claimedBy", "expiresAt", "fundingTxHash", "relayAvailable", "senderAddress", "settlementTxHash", "status", "transferId"].sort(),
    );
    for (const secret of ["Private note", "María", "Secret", "Ana Sender", "WhatsApp", "0000 1111", "MX"]) expect(text).not.toContain(secret);
    expect(body.status).toBe("awaiting_claim");
    expect(body.relayAvailable).toBe(true);
  });

  it("404s for unknown ids and for direct transfers", async () => {
    expect((await getInfo("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await getInfo("nope")).status).toBe(404);
  });

  it("relayAvailable is false when no relayer key is configured or its balance is too low", async () => {
    const { transfer } = await funded();
    setRelayerForTests(null);
    expect((await (await getInfo(transfer.id)).json()).relayAvailable).toBe(false);
    setRelayerForTests(relayer);
    resetRelayerCacheForTests();
    chain.native.set(RELAYER.toLowerCase(), 1n);
    expect((await (await getInfo(transfer.id)).json()).relayAvailable).toBe(false);
  });
});

describe("claim view proof", () => {
  it("reveals note + opted-in sender name only with a valid, fresh claim-key proof", async () => {
    const { transfer, key } = await funded();
    const issuedAt = nowSec();
    const ok = await viewPOST(req(`/api/claims/${transfer.id}/view`, { json: { issuedAt, signature: await signViewProof(key.privateKey, transfer.id, issuedAt) } }), params({ id: transfer.id }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ senderDisplayName: "Ana Sender", note: "Private note for María", destinationCountry: "MX" });

    const forgedKey = ("0x" + "ee".repeat(32)) as Hex;
    const forged = await viewPOST(req(`/api/claims/${transfer.id}/view`, { json: { issuedAt, signature: await signViewProof(forgedKey, transfer.id, issuedAt) } }), params({ id: transfer.id }));
    expect(forged.status).toBe(401);
    expect((await forged.json()).error.code).toBe("invalid_proof");

    // A proof for another transfer id doesn't transfer over.
    const wrongId = await viewPOST(
      req(`/api/claims/${transfer.id}/view`, { json: { issuedAt, signature: await signViewProof(key.privateKey, "00000000-0000-4000-8000-000000000000", issuedAt) } }),
      params({ id: transfer.id }),
    );
    expect(wrongId.status).toBe(401);

    const old = issuedAt - 601;
    const stale = await viewPOST(req(`/api/claims/${transfer.id}/view`, { json: { issuedAt: old, signature: await signViewProof(key.privateKey, transfer.id, old) } }), params({ id: transfer.id }));
    expect(stale.status).toBe(401);
    expect((await stale.json()).error.code).toBe("proof_stale");
  });
});

describe("gas relay", () => {
  it("relays a valid claim: simulate → send → claim_submitted", async () => {
    const { transfer, key, chainId } = await funded();
    const signature = await signClaim(key.privateKey, contracts.manager, chainId, RECIPIENT as Address);
    const res = await relay(transfer.id, { recipient: RECIPIENT, signature });
    expect(res.status).toBe(200);
    const { txHash } = await res.json();
    expect(relayer.simulated).toHaveLength(1);
    expect(relayer.sent).toHaveLength(1);
    const info = await (await getInfo(transfer.id)).json();
    expect(info.status).toBe("claim_submitted");
    const [att] = await sql<{ status: string; tx_hash: string; ip_hash: string }>`SELECT status, tx_hash, ip_hash FROM relay_attempts`;
    expect(att).toMatchObject({ status: "submitted", tx_hash: txHash.toLowerCase() });
    expect(att.ip_hash).not.toContain("1.2.3.4");
    // one in-flight relay per transfer
    const again = await relay(transfer.id, { recipient: RECIPIENT, signature }, "5.6.7.8");
    expect(again.status).toBe(409);
    expect(relayer.sent).toHaveLength(1);
  });

  it("rejects a signature for another recipient / from another key without simulating or sending", async () => {
    const { transfer, key, chainId } = await funded();
    const sigForOther = await signClaim(key.privateKey, contracts.manager, chainId, SENDER as Address);
    const r1 = await relay(transfer.id, { recipient: RECIPIENT, signature: sigForOther });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error.code).toBe("invalid_claim_signature");
    const wrongKey = await signClaim(("0x" + "ef".repeat(32)) as Hex, contracts.manager, chainId, RECIPIENT as Address);
    expect((await relay(transfer.id, { recipient: RECIPIENT, signature: wrongKey }, "9.9.9.9")).status).toBe(400);
    expect(relayer.simulated).toHaveLength(0);
    expect(relayer.sent).toHaveLength(0);
    const rejected = await sql`SELECT 1 FROM relay_attempts WHERE status = 'rejected'`;
    expect(rejected).toHaveLength(2);
  });

  it("rejects expired and already-claimed transfers without sending", async () => {
    const { transfer, key, chainId } = await funded();
    const signature = await signClaim(key.privateKey, contracts.manager, chainId, RECIPIENT as Address);
    chain.claimable.set(chainId, false);
    chain.transfers.set(chainId, { ...chain.transfers.get(chainId)!, status: "claimed" });
    const claimed = await relay(transfer.id, { recipient: RECIPIENT, signature });
    expect(claimed.status).toBe(409);
    expect((await claimed.json()).error.message).toMatch(/already claimed/);

    chain.transfers.set(chainId, { ...chain.transfers.get(chainId)!, status: "funded" });
    chain.claimable.set(chainId, true);
    clock.set(() => addSeconds(T0, 86401));
    const expired = await relay(transfer.id, { recipient: RECIPIENT, signature }, "4.4.4.4");
    expect(expired.status).toBe(409);
    expect(relayer.sent).toHaveLength(0);
    expect(relayer.simulated).toHaveLength(0);
  });

  it("does not send when the simulation reverts", async () => {
    const { transfer, key, chainId } = await funded();
    relayer.simulateError = new Error("execution reverted: InvalidClaimSignature()");
    const signature = await signClaim(key.privateKey, contracts.manager, chainId, RECIPIENT as Address);
    const res = await relay(transfer.id, { recipient: RECIPIENT, signature });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("claim_would_fail");
    expect(relayer.sent).toHaveLength(0);
  });

  it("503 relay_unavailable without a relayer key or with too little gas", async () => {
    const { transfer, key, chainId } = await funded();
    const signature = await signClaim(key.privateKey, contracts.manager, chainId, RECIPIENT as Address);
    setRelayerForTests(null);
    const r1 = await relay(transfer.id, { recipient: RECIPIENT, signature });
    expect(r1.status).toBe(503);
    expect((await r1.json()).error.code).toBe("relay_unavailable");
    setRelayerForTests(relayer);
    resetRelayerCacheForTests();
    chain.native.set(RELAYER.toLowerCase(), 0n);
    expect((await relay(transfer.id, { recipient: RECIPIENT, signature }, "2.2.2.2")).status).toBe(503);
    expect(relayer.sent).toHaveLength(0);
  });

  it("rate limits relay attempts per IP", async () => {
    const { transfer } = await funded();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await relay(transfer.id, { recipient: RECIPIENT, signature: "0x" + "00".repeat(65) }, "7.7.7.7")).status);
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
