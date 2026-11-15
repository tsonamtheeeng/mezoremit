import "./setup-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { addSeconds, clock } from "@/lib/server/clock";
import { setChainForTests } from "@/lib/server/chain";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { setFxFetchForTests } from "@/lib/server/fx";
import { runIndexerPass } from "@/lib/server/indexer";
import { SIGNATURE_HEADER, sandboxSign } from "@/lib/server/providers/sandbox";
import { getTransferFor } from "@/lib/server/transfers";
import { advanceSandboxPayouts, inProcessDeliver } from "@/lib/server/webhooks";
import { GET as optionsGET } from "@/app/api/payouts/options/route";
import { POST as payoutPOST } from "@/app/api/payouts/route";
import { GET as payoutGET } from "@/app/api/payouts/[id]/route";
import { POST as webhookPOST } from "@/app/api/webhooks/[provider]/route";
import { E18, FakeChain, RECIPIENT, SENDER, STRANGER, params, req, sessionFor } from "./fakes";
import { T0, claimOnChain, claimTransfer, fundClaimOnChain } from "./scenario";

let sql: Sql;
let chain: FakeChain;

beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
  chain = new FakeChain();
  setChainForTests(chain);
  setFxFetchForTests((async () =>
    Response.json({ result: "success", base_code: "USD", time_last_update_unix: 1_900_000_000, rates: { USD: 1, MXN: 20, PHP: 58 } })) as unknown as typeof fetch);
});
afterEach(() => setFxFetchForTests(null));

async function claimedTransfer(amount = 25n * E18) {
  const a = await sessionFor(SENDER);
  const rec = await sessionFor(RECIPIENT);
  const { transfer } = await claimTransfer(sql, a.session, { amount: amount.toString() });
  const { chainId } = fundClaimOnChain(chain, transfer);
  claimOnChain(chain, chainId, RECIPIENT, RECIPIENT, 20n);
  await runIndexerPass(sql, chain, { confirmations: 0 });
  return { a, rec, transfer };
}

async function requestPayout(cookie: string, transferId: string) {
  const res = await payoutPOST(req("/api/payouts", { cookie, json: { transferId, provider: "sandbox" } }));
  return { status: res.status, body: await res.json() };
}

function webhook(body: unknown, opts: { sig?: string; t?: number } = {}) {
  const raw = JSON.stringify(body);
  const t = opts.t ?? Math.floor(clock.now().getTime() / 1000);
  return webhookPOST(
    req("/api/webhooks/sandbox", { method: "POST", body: raw, headers: { [SIGNATURE_HEADER]: opts.sig ?? sandboxSign(raw, t), "content-type": "application/json" } }),
    params({ provider: "sandbox" }),
  );
}

describe("sandbox payouts", () => {
  it("options + request: only the claiming recipient, simulated, amount from a fresh sandbox quote", async () => {
    const { a, rec, transfer } = await claimedTransfer();
    const stranger = await sessionFor(STRANGER);
    expect((await optionsGET(req(`/api/payouts/options?transferId=${transfer.id}`, { cookie: stranger.cookie }))).status).toBe(404);
    expect((await optionsGET(req(`/api/payouts/options?transferId=${transfer.id}`, { cookie: a.cookie }))).status).toBe(404);
    const opts = await (await optionsGET(req(`/api/payouts/options?transferId=${transfer.id}`, { cookie: rec.cookie }))).json();
    expect(opts.options).toEqual([expect.objectContaining({ provider: "sandbox", providerLabel: "MezoRemit Sandbox (simulated)", simulated: true, currency: "MXN", kycRequired: false })]);

    expect((await requestPayout(a.cookie, transfer.id)).status).toBe(404);
    const r = await requestPayout(rec.cookie, transfer.id);
    expect(r.status).toBe(200);
    expect(r.body.payout).toMatchObject({ status: "requested", simulated: true, destinationCurrency: "MXN", payoutAmount: "492.5", statusDetail: "Simulated — no money moved" }); // 25 × 20 × 0.985
    expect((await requestPayout(rec.cookie, transfer.id)).status).toBe(409);
    const t = await getTransferFor(sql, rec.session, transfer.id);
    expect(t.payout?.id).toBe(r.body.payout.id);
    expect(t.timeline.find((e) => e.kind === "payout_requested")).toMatchObject({ source: "sandbox" });
    // The sender's view never shows the recipient's payout.
    const asSender = await getTransferFor(sql, a.session, transfer.id);
    expect(asSender.payout).toBeNull();
    expect(asSender.timeline.some((e) => e.kind.startsWith("payout_"))).toBe(false);
  });

  it("advances requested → processing → completed only via signed webhooks", async () => {
    const { rec, transfer } = await claimedTransfer();
    const { body } = await requestPayout(rec.cookie, transfer.id);
    const id = body.payout.id;
    const deliver = inProcessDeliver(sql);
    const status = async () => (await (await payoutGET(req(`/api/payouts/${id}`, { cookie: rec.cookie }), params({ id }))).json()).payout.status;

    expect(await advanceSandboxPayouts(sql, deliver)).toBe(0); // too early
    clock.set(() => addSeconds(T0, 10));
    expect(await advanceSandboxPayouts(sql, deliver)).toBe(1);
    expect(await status()).toBe("processing");
    clock.set(() => addSeconds(T0, 20));
    expect(await advanceSandboxPayouts(sql, deliver)).toBe(0);
    clock.set(() => addSeconds(T0, 30));
    expect(await advanceSandboxPayouts(sql, deliver)).toBe(1);
    expect(await status()).toBe("completed");
    const kinds = (await sql<{ type: string }>`SELECT type FROM notifications WHERE user_id = ${rec.userId} ORDER BY created_at`).map((r) => r.type);
    expect(kinds).toContain("payout_completed");
    const hooks = await sql<{ signature_valid: boolean; processing_status: string }>`SELECT signature_valid, processing_status FROM provider_webhooks`;
    expect(hooks).toEqual([
      { signature_valid: true, processing_status: "processed" },
      { signature_valid: true, processing_status: "processed" },
    ]);
    const t = await getTransferFor(sql, rec.session, transfer.id);
    for (const e of t.timeline.filter((x) => x.kind.startsWith("payout_"))) {
      expect(e.source).toBe("sandbox");
      expect(e.detail).toContain("Simulated — no money moved");
    }
  });

  it("amounts ending in .13 MUSD fail the simulated payout", async () => {
    const { rec, transfer } = await claimedTransfer(25n * E18 + 13n * 10n ** 16n);
    const { body } = await requestPayout(rec.cookie, transfer.id);
    const deliver = inProcessDeliver(sql);
    clock.set(() => addSeconds(T0, 10));
    await advanceSandboxPayouts(sql, deliver);
    clock.set(() => addSeconds(T0, 30));
    await advanceSandboxPayouts(sql, deliver);
    const [p] = await sql<{ status: string; status_detail: string }>`SELECT status, status_detail FROM payout_requests WHERE id = ${body.payout.id}`;
    expect(p.status).toBe("failed");
    expect(p.status_detail).toMatch(/Simulated — no money moved.*\.13 MUSD/);
    // After a failure the recipient may request again.
    expect((await requestPayout(rec.cookie, transfer.id)).status).toBe(200);
  });

  it("webhook HMAC: rejects bad/stale signatures, ignores replays, refuses illegal jumps", async () => {
    const { rec, transfer } = await claimedTransfer();
    const { body } = await requestPayout(rec.cookie, transfer.id);
    const p = body.payout;
    const ev = (type: string, id = `evt-${type}`) => ({ id, type, createdAt: clock.now().toISOString(), data: { payoutId: p.id, providerReference: p.providerReference } });

    const forged = await webhook(ev("payout.completed"), { sig: `t=${Math.floor(clock.now().getTime() / 1000)},v1=${"0".repeat(64)}` });
    expect(forged.status).toBe(401);
    const stale = await webhook(ev("payout.completed"), { t: Math.floor(clock.now().getTime() / 1000) - 301 });
    expect(stale.status).toBe(401);
    const otherSecret = JSON.stringify(ev("payout.completed"));
    const wrongKey = await webhook(ev("payout.completed"), { sig: sandboxSign(otherSecret, Math.floor(clock.now().getTime() / 1000), "some-other-secret-value") });
    expect(wrongKey.status).toBe(401);
    // A forged attempt must not burn the real event id.
    const [{ n: rejected }] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM provider_webhooks WHERE signature_valid = FALSE AND event_id LIKE 'invalid:%'`;
    expect(rejected).toBe(3);

    // requested → completed directly is not a legal transition.
    const jump = await webhook(ev("payout.completed", "evt-jump"));
    expect((await jump.json()).ignored).toBe("invalid_transition");
    expect((await sql<{ status: string }>`SELECT status FROM payout_requests`)[0].status).toBe("requested");

    expect((await (await webhook(ev("payout.processing"))).json()).status).toBe("processing");
    const replay = await (await webhook(ev("payout.processing"))).json();
    expect(replay.duplicate).toBe(true);
    expect((await (await webhook(ev("payout.completed"))).json()).status).toBe("completed");
    const [{ n }] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM notifications WHERE type = 'payout_completed'`;
    expect(n).toBe(1);
  });

  it("no client-facing route can complete a payout (only GET + create exist)", async () => {
    const mod = await import("@/app/api/payouts/[id]/route");
    expect(Object.keys(mod).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });
});
