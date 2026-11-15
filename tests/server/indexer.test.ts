import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Address, Hex } from "viem";
import { addSeconds, clock } from "@/lib/server/clock";
import { decodeLog, setChainForTests, type DecodedLog } from "@/lib/server/chain";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { ingestLogs, runIndexerPass } from "@/lib/server/indexer";
import { expirySweep, pendingTxSweep } from "@/lib/server/sweeps";
import { getTransferFor, reportFunding } from "@/lib/server/transfers";
import { GET as detailGET } from "@/app/api/transfers/[id]/route";
import { POST as confirmPOST } from "@/app/api/transfers/[id]/confirm/route";
import { E18, FakeChain, RECIPIENT, RELAYER, SENDER, STRANGER, params, rawLog, req, sessionFor, txHash } from "./fakes";
import { T0, claimOnChain, claimTransfer, directTransfer, fundClaimOnChain, fundDirectOnChain } from "./scenario";

let sql: Sql;
let chain: FakeChain;
const count = async (table: string, where = "TRUE") =>
  Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE ${sql.raw(where)}`)[0].n);
const row = async (id: string) => (await sql<Record<string, unknown>>`SELECT * FROM transfers WHERE id = ${id}`)[0];
const decoded = (...logs: Parameters<typeof decodeLog>[0][]) => logs.map((l) => decodeLog(l)).filter(Boolean) as DecodedLog[];

beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
  chain = new FakeChain();
  setChainForTests(chain);
});

describe("indexer ingest", () => {
  it("claim lifecycle: funded → claimed (relayed), timeline from chain, notifications deduped", async () => {
    const a = await sessionFor(SENDER);
    const rec = await sessionFor(RECIPIENT);
    const { transfer } = await claimTransfer(sql, a.session);
    const { hash: fundHash, chainId } = fundClaimOnChain(chain, transfer);
    const p1 = await runIndexerPass(sql, chain, { confirmations: 0 });
    expect(p1.applied).toBe(1);
    let t = await getTransferFor(sql, a.session, transfer.id);
    expect(t.status).toBe("awaiting_claim");
    expect(t.chainTransferId).toBe("1");
    expect(t.fundingTxHash).toBe(fundHash.toLowerCase());
    expect(t.fundedAt).toBe(new Date(Number(chain.blockTime(10n)) * 1000).toISOString());
    expect(t.timeline.find((e) => e.kind === "funded")).toMatchObject({ source: "chain", txHash: fundHash.toLowerCase() });

    claimOnChain(chain, chainId, RECIPIENT, RELAYER, 110n);
    chain.head = 120n;
    await runIndexerPass(sql, chain, { confirmations: 0 });
    t = await getTransferFor(sql, a.session, transfer.id);
    expect(t.status).toBe("claimed");
    const [claim] = await sql<Record<string, unknown>>`SELECT * FROM claims`;
    expect(claim.recipient_wallet).toBe(RECIPIENT);
    expect(claim.relayed).toBe(true);
    // recipient can now see it
    const asRecipient = await getTransferFor(sql, rec.session, transfer.id);
    expect(asRecipient.role).toBe("recipient");
    expect(asRecipient.quote).toBeNull();
    const kinds = (await sql<{ type: string }>`SELECT type FROM notifications ORDER BY type`).map((r) => r.type);
    expect(kinds).toEqual(["transfer_claimed", "transfer_funded", "transfer_received"]);
  });

  it("is idempotent: ingesting the same logs twice changes nothing", async () => {
    const a = await sessionFor(SENDER);
    const { transfer } = await claimTransfer(sql, a.session);
    const { log } = fundClaimOnChain(chain, transfer);
    const snapshot = async () => ({
      t: await row(transfer.id),
      events: await count("blockchain_events"),
      timeline: await count("transfer_timeline"),
      notifications: await count("notifications"),
    });
    expect(await ingestLogs(sql, chain, decoded(log))).toBe(1);
    const before = await snapshot();
    expect(await ingestLogs(sql, chain, decoded(log, log))).toBe(0);
    await runIndexerPass(sql, chain, { confirmations: 0 }); // the indexer sees it again too
    expect(await snapshot()).toEqual(before);
  });

  it("does not complete a transfer when the on-chain amount differs (audited, failed)", async () => {
    const a = await sessionFor(SENDER);
    const { transfer: t2 } = await claimTransfer(sql, a.session);
    fundClaimOnChain(chain, t2, { chainId: 2n, amount: 1n * E18, block: 11n });
    await runIndexerPass(sql, chain, { confirmations: 0 });
    const t = await getTransferFor(sql, a.session, t2.id);
    expect(t.status).toBe("failed");
    expect(t.timeline.find((e) => e.kind === "failed")?.detail).toMatch(/did not match/);
    const audits = await sql<{ metadata: { fields: string[] } }>`SELECT metadata FROM audit_logs WHERE action = 'funding_mismatch' ORDER BY id`;
    expect(audits.map((x) => x.metadata.fields)).toEqual([["amount"]]);
    expect(await count("notifications")).toBe(0);
    // Reconciliation must not "heal" a mismatch into awaiting_claim.
    await runIndexerPass(sql, chain, { confirmations: 0, reconcile: true });
    expect((await row(t2.id)).status).toBe("failed");
  });

  it("ignores another wallet's event that copies a transfer's ref; the real funding still lands", async () => {
    const a = await sessionFor(SENDER);
    const { transfer: t1 } = await claimTransfer(sql, a.session);
    // Attacker front-runs with the same ref from their own address (allowed on-chain: refs are per sender).
    fundClaimOnChain(chain, t1, { chainId: 1n, sender: STRANGER as Address, amount: 1n });
    await runIndexerPass(sql, chain, { confirmations: 0 });
    expect((await row(t1.id)).status).toBe("awaiting_funding");
    expect((await row(t1.id)).chain_transfer_id).toBeNull();
    const foreign = await sql`SELECT 1 FROM audit_logs WHERE action = 'foreign_ref_event'`;
    expect(foreign.length).toBe(1);
    // The sender's own funding afterwards is accepted normally.
    chain.head = 120n;
    fundClaimOnChain(chain, t1, { chainId: 2n, block: 110n });
    await runIndexerPass(sql, chain, { confirmations: 0 });
    expect((await row(t1.id)).status).toBe("awaiting_claim");
    expect(String((await row(t1.id)).chain_transfer_id)).toBe("2");
    expect(await count("audit_logs", "action = 'funding_mismatch'")).toBe(0);
  });

  it("direct: recipient mismatch → failed; match → completed + recipient notified", async () => {
    const a = await sessionFor(SENDER);
    const rec = await sessionFor(RECIPIENT);
    const ok = await directTransfer(sql, a.session);
    const bad = await directTransfer(sql, a.session);
    fundDirectOnChain(chain, ok, { chainId: 1n });
    fundDirectOnChain(chain, bad, { chainId: 2n, recipient: STRANGER as Address, block: 12n });
    await runIndexerPass(sql, chain, { confirmations: 0 });
    expect((await row(ok.id)).status).toBe("completed");
    expect((await row(bad.id)).status).toBe("failed");
    expect(await count("notifications", `user_id = '${rec.userId}' AND type = 'transfer_received'`)).toBe(1);
  });

  it("stores events for unknown refs but ignores them, and never decodes lookalike contracts", async () => {
    const a = await sessionFor(SENDER);
    const { transfer } = await claimTransfer(sql, a.session);
    const unknown = rawLog(
      "ClaimableCreated",
      { transferId: 9n, sender: STRANGER, claimSigner: STRANGER, amount: E18, expiresAt: 2_000_000_000n, ref: ("0x" + "ab".repeat(32)) as Hex },
      { blockNumber: 5n, txHash: txHash() },
    );
    chain.logs.push(unknown);
    fundClaimOnChain(chain, transfer, { address: "0x2222222222222222222222222222222222222222" });
    await runIndexerPass(sql, chain, { confirmations: 0 });
    expect(await count("blockchain_events")).toBe(1);
    expect((await row(transfer.id)).status).toBe("awaiting_funding");
  });

  it("only processes up to head − CONFIRMATIONS and chunks getLogs ≤ 2000 blocks", async () => {
    const a = await sessionFor(SENDER);
    const { transfer } = await claimTransfer(sql, a.session);
    fundClaimOnChain(chain, transfer, { block: 4_500n });
    chain.head = 4_501n;
    const r = await runIndexerPass(sql, chain, { confirmations: 2 });
    expect(r.to).toBe("4499");
    expect((await row(transfer.id)).status).toBe("awaiting_funding");
    expect(chain.calls.filter((c) => c === "getLogs").length).toBe(3);
    chain.head = 4_502n;
    await runIndexerPass(sql, chain, { confirmations: 2 });
    expect((await row(transfer.id)).status).toBe("awaiting_claim");
  });

  it("reorg: cursor hash mismatch rewinds the window, removes orphaned events and re-derives from chain", async () => {
    const a = await sessionFor(SENDER);
    const { transfer } = await claimTransfer(sql, a.session);
    const { chainId } = fundClaimOnChain(chain, transfer, { block: 10n });
    const { hash: claimHash } = claimOnChain(chain, chainId, RECIPIENT, RECIPIENT, 98n);
    await runIndexerPass(sql, chain, { confirmations: 0 });
    expect((await row(transfer.id)).status).toBe("claimed");

    // Blocks 96..100 are replaced; the claim tx is no longer on the canonical chain.
    for (let b = 96n; b <= 100n; b++) chain.fork.set(b, 1);
    chain.logs = chain.logs.filter((l) => l.transactionHash !== claimHash);
    chain.transfers.set(chainId, { ...chain.transfers.get(chainId)!, status: "funded", recipient: "0x0000000000000000000000000000000000000000", settledAt: 0n });
    chain.claimable.set(chainId, true);
    const r = await runIndexerPass(sql, chain, { confirmations: 0 });
    expect(r.rewoundTo).toBe("96");
    const t = await row(transfer.id);
    expect(t.status).toBe("awaiting_claim");
    expect(t.chain_status).toBe("funded");
    expect(t.recipient_wallet).toBeNull();
    expect(await count("claims")).toBe(0);
    expect(await count("blockchain_events", "removed = TRUE")).toBe(1);
    expect(await count("transfer_timeline", "kind = 'claimed'")).toBe(0);
    expect(await count("audit_logs", "action = 'reorg_rewind'")).toBe(1);
    const [cursor] = await sql<{ last_block: string }>`SELECT last_block::text FROM indexer_cursor`;
    expect(cursor.last_block).toBe("100");

    // The claim lands again on the new fork (block 101): re-applied exactly once.
    chain.logs.push({ ...chain.receipts.get(claimHash.toLowerCase())!.logs[0], blockNumber: 101n });
    chain.transfers.set(chainId, { ...chain.transfers.get(chainId)!, status: "claimed", recipient: RECIPIENT });
    chain.head = 101n;
    await runIndexerPass(sql, chain, { confirmations: 0 });
    expect((await row(transfer.id)).status).toBe("claimed");
    expect(await count("blockchain_events", "removed = FALSE")).toBe(2);
    expect(await count("notifications", "type = 'transfer_claimed'")).toBe(1);
  });

  it("reconciliation corrects drift from getTransfer and audits it", async () => {
    const a = await sessionFor(SENDER);
    const { transfer } = await claimTransfer(sql, a.session);
    const { chainId } = fundClaimOnChain(chain, transfer);
    await runIndexerPass(sql, chain, { confirmations: 0 });
    // The chain says Cancelled but we never saw the event (e.g. missed log).
    chain.transfers.set(chainId, { ...chain.transfers.get(chainId)!, status: "cancelled", settledAt: chain.blockTime(30n) });
    const r = await runIndexerPass(sql, chain, { confirmations: 0, reconcile: true });
    expect(r.reconciled).toEqual({ checked: 1, drifted: 1 });
    expect((await row(transfer.id)).status).toBe("cancelled");
    expect(await count("audit_logs", "action = 'chain_drift'")).toBe(1);
    expect(await count("notifications", "type = 'transfer_cancelled'")).toBe(1);
  });
});

describe("hints, receipt confirm and sweeps", () => {
  it("submitted → funding_submitted; confirm verifies the receipt with the same ingest path", async () => {
    const a = await sessionFor(SENDER);
    const { transfer } = await claimTransfer(sql, a.session);
    const hash = txHash("pending");
    const t = await reportFunding(sql, chain, a.session, transfer.id, hash);
    expect(t.status).toBe("funding_submitted");
    expect(t.fundingTxHash).toBe(hash.toLowerCase());
    // The receipt lands later.
    const { log } = fundClaimOnChain(chain, transfer, { block: 90n });
    chain.receipts.set(hash.toLowerCase(), { ...chain.receipts.get(log.transactionHash.toLowerCase())!, transactionHash: hash });
    await sql`UPDATE transfers SET funding_tx_hash = ${log.transactionHash.toLowerCase()} WHERE id = ${transfer.id}`;
    const res = await confirmPOST(req(`/api/transfers/${transfer.id}/confirm`, { method: "POST", cookie: a.cookie }), params({ id: transfer.id }));
    const body = await res.json();
    expect(body.result).toBe("confirmed");
    expect(body.transfer.status).toBe("awaiting_claim");
    // The indexer later sees the same log: no double-apply.
    await runIndexerPass(sql, chain, { confirmations: 0 });
    expect(await count("blockchain_events")).toBe(1);
    expect(await count("notifications", "type = 'transfer_funded'")).toBe(1);
  });

  it("confirm ignores logs from a lookalike contract", async () => {
    const a = await sessionFor(SENDER);
    const { transfer } = await claimTransfer(sql, a.session);
    const { hash } = fundClaimOnChain(chain, transfer, { address: "0x3333333333333333333333333333333333333333" });
    const t = await reportFunding(sql, chain, a.session, transfer.id, hash);
    expect(t.status).toBe("funding_submitted");
    expect(await count("blockchain_events")).toBe(0);
  });

  it("a reverted funding receipt → failed; a hint with no event after 30 min → failed", async () => {
    const a = await sessionFor(SENDER);
    const { transfer: t1 } = await claimTransfer(sql, a.session);
    const { transfer: t2 } = await claimTransfer(sql, a.session);
    const reverted = txHash("rev");
    chain.addTx(reverted, [], { status: "reverted" });
    expect((await reportFunding(sql, chain, a.session, t1.id, reverted)).status).toBe("failed");

    await reportFunding(sql, chain, a.session, t2.id, txHash("never"));
    await pendingTxSweep(sql, chain);
    expect((await row(t2.id)).status).toBe("funding_submitted");
    clock.set(() => addSeconds(T0, 30 * 60 + 1));
    const r = await pendingTxSweep(sql, chain);
    expect(r.failed).toBe(1);
    const t = await getTransferFor(sql, a.session, t2.id);
    expect(t.status).toBe("failed");
    expect(t.timeline.at(-1)?.detail).toMatch(/30 minutes/);
  });

  it("expiry: projected status flips at expires_at; the sweep adds the timeline entry + one notification", async () => {
    const a = await sessionFor(SENDER);
    const { transfer } = await claimTransfer(sql, a.session, { expiresAt: Math.floor(T0.getTime() / 1000) + 120 });
    fundClaimOnChain(chain, transfer);
    await runIndexerPass(sql, chain, { confirmations: 0 });
    expect(await expirySweep(sql)).toBe(0);
    clock.set(() => addSeconds(T0, 121));
    const res = await detailGET(req(`/api/transfers/${transfer.id}`, { cookie: a.cookie }), params({ id: transfer.id }));
    expect((await res.json()).transfer.status).toBe("expired");
    expect(await expirySweep(sql)).toBe(1);
    expect(await expirySweep(sql)).toBe(0);
    expect(await count("notifications", "type = 'transfer_expired'")).toBe(1);
  });
});
