import "./setup-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { addSeconds, clock } from "@/lib/server/clock";
import { setChainForTests, setRelayerForTests } from "@/lib/server/chain";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { runIndexerPass } from "@/lib/server/indexer";
import { notifySender } from "@/lib/server/messages";
import { deliverEmails, EMAIL_MAX_ATTEMPTS, notify } from "@/lib/server/notify";
import { updateSettings } from "@/lib/server/settings";
import { GET as listGET } from "@/app/api/notifications/route";
import { POST as readPOST } from "@/app/api/notifications/read/route";
import { GET as senderDashGET } from "@/app/api/dashboard/sender/route";
import { GET as recipientDashGET } from "@/app/api/dashboard/recipient/route";
import { GET as healthGET } from "@/app/api/health/route";
import { POST as syncPOST } from "@/app/api/indexer/sync/route";
import { E18, FakeChain, RECIPIENT, SENDER, req, sessionFor } from "./fakes";
import { T0, claimOnChain, claimTransfer, fundClaimOnChain } from "./scenario";

let sql: Sql;
let chain: FakeChain;

beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
  chain = new FakeChain();
  setChainForTests(chain);
  setRelayerForTests(null);
});
afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  delete process.env.INDEXER_SECRET;
});

describe("notifications", () => {
  it("dedupes by key and never includes the claim link or key", async () => {
    const a = await sessionFor(SENDER);
    const { transfer, key } = await claimTransfer(sql, a.session);
    fundClaimOnChain(chain, transfer);
    await runIndexerPass(sql, chain, { confirmations: 0 });
    await notifySender(sql, transfer.id, "transfer_funded");
    await notifySender(sql, transfer.id, "transfer_funded");
    const rows = await sql<{ title: string; body: string }>`SELECT title, body FROM notifications`;
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows);
    expect(text).not.toContain("/claim/");
    expect(text).not.toContain(key.privateKey.slice(2));
    expect(text).not.toContain("Para la renta"); // the private note
  });

  it("list + mark read through the API (owner-scoped)", async () => {
    const a = await sessionFor(SENDER);
    const b = await sessionFor(RECIPIENT);
    for (const k of ["x", "y"]) await notify(sql, { userId: a.userId, transferId: null, type: "transfer_funded", title: "t", body: "b", dedupeKey: k });
    const list = await (await listGET(req("/api/notifications", { cookie: a.cookie }))).json();
    expect(list.unread).toBe(2);
    expect(list.notifications[0].email).toBeNull();
    // B can't mark A's notifications read
    await readPOST(req("/api/notifications/read", { cookie: b.cookie, json: { ids: [list.notifications[0].id] } }));
    expect((await (await listGET(req("/api/notifications", { cookie: a.cookie }))).json()).unread).toBe(2);
    const r = await (await readPOST(req("/api/notifications/read", { cookie: a.cookie, json: { ids: [list.notifications[0].id] } }))).json();
    expect(r.updated).toBe(1);
    await readPOST(req("/api/notifications/read", { cookie: a.cookie, json: {} }));
    expect((await (await listGET(req("/api/notifications", { cookie: a.cookie }))).json()).unread).toBe(0);
  });

  it("email: queued only for opted-in users, 'sent' only when Resend returns an id, retried then failed", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "MezoRemit <noreply@example.com>";
    const a = await sessionFor(SENDER);
    const b = await sessionFor(RECIPIENT);
    await updateSettings(sql, a.userId, { email: "a@example.com", emailNotifications: true });
    await updateSettings(sql, b.userId, { email: "b@example.com" }); // not opted in
    await notify(sql, { userId: a.userId, transferId: null, type: "transfer_claimed", title: "Transfer claimed", body: "ok", dedupeKey: "e1" });
    await notify(sql, { userId: b.userId, transferId: null, type: "transfer_received", title: "x", body: "y", dedupeKey: "e2" });
    expect((await sql`SELECT 1 FROM notification_deliveries`).length).toBe(1);

    const bodies: unknown[] = [];
    const noId = (async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({}, { status: 200 });
    }) as typeof fetch;
    expect(await deliverEmails(sql, { fetch: noId })).toEqual({ sent: 0, failed: 0, retried: 1 });
    expect((await sql<{ status: string }>`SELECT status FROM notification_deliveries`)[0].status).toBe("queued");
    expect(JSON.stringify(bodies)).not.toContain("/claim/");

    clock.set(() => addSeconds(T0, 120));
    const ok = (async () => Response.json({ id: "email_123" })) as unknown as typeof fetch;
    expect(await deliverEmails(sql, { fetch: ok })).toEqual({ sent: 1, failed: 0, retried: 0 });
    const [d] = await sql<{ status: string; provider_message_id: string }>`SELECT status, provider_message_id FROM notification_deliveries`;
    expect(d).toEqual({ status: "sent", provider_message_id: "email_123" });
    const list = await (await listGET(req("/api/notifications", { cookie: a.cookie }))).json();
    expect(list.notifications[0].email).toEqual({ status: "sent" });

    // permanent failure path
    await notify(sql, { userId: a.userId, transferId: null, type: "transfer_claimed", title: "t", body: "b", dedupeKey: "e3" });
    const down = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    for (let i = 0; i < EMAIL_MAX_ATTEMPTS; i++) {
      clock.set(() => addSeconds(T0, 10_000 * (i + 1)));
      await deliverEmails(sql, { fetch: down });
    }
    const [f] = await sql<{ status: string; attempts: number }>`SELECT status, attempts FROM notification_deliveries WHERE status <> 'sent'`;
    expect(f).toEqual({ status: "failed", attempts: EMAIL_MAX_ATTEMPTS });
  });

  it("backfills transfer_received on a recipient's first sign-in", async () => {
    const a = await sessionFor(SENDER);
    const { transfer } = await claimTransfer(sql, a.session);
    const { chainId } = fundClaimOnChain(chain, transfer);
    claimOnChain(chain, chainId, RECIPIENT, RECIPIENT, 20n);
    await runIndexerPass(sql, chain, { confirmations: 0 });
    expect((await sql`SELECT 1 FROM notifications WHERE type = 'transfer_received'`).length).toBe(0);
    const { backfillReceivedNotifications } = await import("@/lib/server/messages");
    const rec = await sessionFor(RECIPIENT);
    expect(await backfillReceivedNotifications(sql, rec.userId, RECIPIENT)).toBe(1);
    expect((await sql`SELECT 1 FROM notifications WHERE type = 'transfer_received'`).length).toBe(1);
  });
});

describe("dashboards, health, cron sync", () => {
  it("sender + recipient dashboards; recipient balance is live and null on RPC failure", async () => {
    const a = await sessionFor(SENDER);
    const rec = await sessionFor(RECIPIENT);
    const { transfer } = await claimTransfer(sql, a.session);
    const { chainId } = fundClaimOnChain(chain, transfer);
    claimOnChain(chain, chainId, RECIPIENT, RECIPIENT, 20n);
    await claimTransfer(sql, a.session);
    await runIndexerPass(sql, chain, { confirmations: 0 });
    const s = await (await senderDashGET(req("/api/dashboard/sender", { cookie: a.cookie }))).json();
    expect(s.totals).toEqual({ sentCompleted: (25n * E18).toString(), transfers: 2, pending: 1, completed: 1, refunded: 0, failed: 0 });
    chain.balances.set(RECIPIENT, 25n * E18);
    const r = await (await recipientDashGET(req("/api/dashboard/recipient", { cookie: rec.cookie }))).json();
    expect(r.totals).toEqual({ received: (25n * E18).toString(), transfers: 1 });
    expect(r.musdBalance).toBe((25n * E18).toString());
    expect(r.received[0].role).toBe("recipient");
    chain.failing.add("musdBalanceOf");
    expect((await (await recipientDashGET(req("/api/dashboard/recipient", { cookie: rec.cookie }))).json()).musdBalance).toBeNull();
  });

  it("health reports chain, indexer lag, db and relayer", async () => {
    await runIndexerPass(sql, chain, { confirmations: 0 });
    const h = await (await healthGET()).json();
    expect(h).toMatchObject({ ok: true, chainId: 31611, latestBlock: "100", deployed: true, db: "pglite", relayer: { enabled: false } });
    expect(h.indexer.lagBlocks).toBe(0);
    chain.failing.add("getBlockNumber");
    const down = await healthGET();
    expect(down.status).toBe(503);
  });

  it("POST /api/indexer/sync requires the bearer secret", async () => {
    expect((await syncPOST(req("/api/indexer/sync", { method: "POST" }))).status).toBe(404); // disabled without a secret
    process.env.INDEXER_SECRET = "s3cret-token-value";
    expect((await syncPOST(req("/api/indexer/sync", { method: "POST", headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    const ok = await syncPOST(req("/api/indexer/sync", { method: "POST", headers: { authorization: "Bearer s3cret-token-value" } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).indexer).not.toBeNull();
  });
});
