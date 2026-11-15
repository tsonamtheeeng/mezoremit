import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { transferRef } from "@/lib/chain/claim";
import { addSeconds, clock } from "@/lib/server/clock";
import { setChainForTests } from "@/lib/server/chain";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { projectStatus } from "@/lib/server/status";
import { GET as listGET, POST as createPOST } from "@/app/api/transfers/route";
import { GET as detailGET } from "@/app/api/transfers/[id]/route";
import { E18, FakeChain, RECIPIENT, SENDER, STRANGER, params, req, sessionFor } from "./fakes";
import { T0, nowSec } from "./scenario";

let sql: Sql;
beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
  setChainForTests(new FakeChain());
});

const claimSigner = "0x9999999999999999999999999999999999999999";
const amount = (25n * E18).toString();

async function post(cookie: string, body: Record<string, unknown>) {
  const res = await createPOST(req("/api/transfers", { cookie, json: body }));
  return { status: res.status, body: await res.json() };
}

describe("create transfer", () => {
  it("creates a claim transfer with a server-generated id and ref = transferRef(id)", async () => {
    const a = await sessionFor(SENDER);
    const r = await post(a.cookie, { method: "claim", amount, destinationCountry: "MX", claimSigner, expiresAt: nowSec() + 3600, idempotencyKey: "k1", note: "hola" });
    expect(r.status).toBe(200);
    const t = r.body.transfer;
    expect(t.ref).toBe(transferRef(t.id).toLowerCase());
    expect(t.status).toBe("awaiting_funding");
    expect(t.role).toBe("sender");
    expect(t.claimSigner).toBe(claimSigner);
    expect(t.timeline.map((e: { kind: string }) => e.kind)).toEqual(["created"]);
  });

  it("is idempotent per (user, key): the same key returns the same transfer, no second row", async () => {
    const a = await sessionFor(SENDER);
    const body = { method: "direct", amount, destinationCountry: "US", recipientWallet: RECIPIENT, idempotencyKey: "same" };
    const r1 = await post(a.cookie, body);
    const r2 = await post(a.cookie, { ...body, amount: "1" });
    expect(r2.body.transfer.id).toBe(r1.body.transfer.id);
    expect(r2.body.transfer.amount).toBe(amount);
    const [{ n }] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM transfers`;
    expect(n).toBe(1);
    // Another user may reuse the key.
    const b = await sessionFor(STRANGER);
    const r3 = await post(b.cookie, body);
    expect(r3.body.transfer.id).not.toBe(r1.body.transfer.id);
  });

  it("validates method-specific fields, amount bounds and country", async () => {
    const a = await sessionFor(SENDER);
    const base = { amount, destinationCountry: "US", idempotencyKey: "v" };
    const cases: [Record<string, unknown>, number, string][] = [
      [{ method: "direct", recipientWallet: SENDER }, 400, "self_transfer"],
      [{ method: "direct" }, 400, "recipient_wallet_required"],
      [{ method: "direct", recipientWallet: RECIPIENT, claimSigner }, 400, "invalid_request"],
      [{ method: "claim", expiresAt: nowSec() + 3600 }, 400, "claim_signer_required"],
      [{ method: "claim", claimSigner, recipientWallet: RECIPIENT, expiresAt: nowSec() + 3600 }, 400, "invalid_request"],
      [{ method: "claim", claimSigner, expiresAt: nowSec() + 30 }, 400, "invalid_expiry"],
      [{ method: "claim", claimSigner, expiresAt: nowSec() + 91 * 86400 }, 400, "invalid_expiry"],
      [{ method: "claim", claimSigner: SENDER, expiresAt: nowSec() + 3600 }, 400, "invalid_claim_signer"],
      [{ method: "direct", recipientWallet: RECIPIENT, amount: "0" }, 400, "invalid_amount"],
      [{ method: "direct", recipientWallet: RECIPIENT, amount: (10_000_001n * E18).toString() }, 400, "amount_too_large"],
      [{ method: "direct", recipientWallet: RECIPIENT, amount: "1.5" }, 400, "invalid_amount"],
      [{ method: "direct", recipientWallet: RECIPIENT, destinationCountry: "NP" }, 422, "country_unsupported"],
      [{ method: "direct", recipientWallet: RECIPIENT, note: "x".repeat(281) }, 400, "validation_error"],
      [{ method: "direct", recipientWallet: RECIPIENT, recipientId: "00000000-0000-4000-8000-000000000000" }, 404, "not_found"],
    ];
    let i = 0;
    for (const [over, status, code] of cases) {
      const r = await post(a.cookie, { ...base, idempotencyKey: `v${i++}`, ...over });
      expect([r.status, r.body.error?.code], JSON.stringify(over)).toEqual([status, code]);
    }
    // Boundaries are inclusive.
    expect((await post(a.cookie, { ...base, method: "claim", claimSigner, expiresAt: nowSec() + 60, idempotencyKey: "lo" })).status).toBe(200);
    expect((await post(a.cookie, { ...base, method: "claim", claimSigner, expiresAt: nowSec() + 90 * 86400, idempotencyKey: "hi" })).status).toBe(200);
  });

  it("isolates transfers: strangers get 404, list shows only own", async () => {
    const a = await sessionFor(SENDER);
    const b = await sessionFor(STRANGER);
    const r = await post(a.cookie, { method: "direct", amount, destinationCountry: "US", recipientWallet: RECIPIENT, idempotencyKey: "iso" });
    const id = r.body.transfer.id;
    expect((await detailGET(req(`/api/transfers/${id}`, { cookie: b.cookie }), params({ id }))).status).toBe(404);
    expect((await detailGET(req(`/api/transfers/not-a-uuid`, { cookie: a.cookie }), params({ id: "not-a-uuid" }))).status).toBe(404);
    // The intended recipient can't see a direct transfer before it's verified on-chain.
    const rec = await sessionFor(RECIPIENT);
    expect((await detailGET(req(`/api/transfers/${id}`, { cookie: rec.cookie }), params({ id }))).status).toBe(404);
    const listB = await (await listGET(req("/api/transfers", { cookie: b.cookie }))).json();
    expect(listB.transfers).toEqual([]);
    const listA = await (await listGET(req("/api/transfers?role=sent", { cookie: a.cookie }))).json();
    expect(listA.transfers.map((t: { id: string }) => t.id)).toEqual([id]);
  });

  it("paginates with a cursor", async () => {
    const a = await sessionFor(SENDER);
    for (let i = 0; i < 3; i++) {
      clock.set(() => addSeconds(T0, i));
      await post(a.cookie, { method: "direct", amount, destinationCountry: "US", recipientWallet: RECIPIENT, idempotencyKey: `p${i}` });
    }
    const p1 = await (await listGET(req("/api/transfers?limit=2", { cookie: a.cookie }))).json();
    expect(p1.transfers).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await (await listGET(req(`/api/transfers?limit=2&cursor=${p1.nextCursor}`, { cookie: a.cookie }))).json();
    expect(p2.transfers).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
  });
});

describe("status projection", () => {
  it("derives expired only for funded claims past expires_at", () => {
    const exp = new Date(T0.getTime() + 1000);
    const base = { method: "claim", status: "awaiting_claim", chain_status: "funded", expires_at: exp };
    expect(projectStatus(base, T0)).toBe("awaiting_claim");
    expect(projectStatus(base, new Date(exp.getTime()))).toBe("expired");
    expect(projectStatus({ ...base, status: "claim_submitted" }, new Date(exp.getTime() + 1))).toBe("expired");
    expect(projectStatus({ ...base, chain_status: "claimed", status: "claimed" }, new Date(exp.getTime() + 1))).toBe("claimed");
    expect(projectStatus({ ...base, chain_status: "refunded", status: "refunded" }, new Date(exp.getTime() + 1))).toBe("refunded");
    expect(projectStatus({ ...base, method: "direct", status: "completed", chain_status: "completed" }, new Date(exp.getTime() + 1))).toBe("completed");
  });
});
