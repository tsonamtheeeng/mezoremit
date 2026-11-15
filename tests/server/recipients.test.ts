import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { clock } from "@/lib/server/clock";
import { decryptContact, encryptContact } from "@/lib/server/crypto";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { GET as listGET, POST as createPOST } from "@/app/api/recipients/route";
import { DELETE as recDELETE, PATCH as recPATCH } from "@/app/api/recipients/[id]/route";
import { RECIPIENT, SENDER, STRANGER, params, req, sessionFor } from "./fakes";
import { T0 } from "./scenario";

let sql: Sql;
beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
});

const input = { displayName: "María López", country: "MX", walletAddress: RECIPIENT, preferredDeliveryMethod: "mezo_wallet", contactReference: "WhatsApp +52 55 1234 5678" };

describe("recipient book", () => {
  it("is owner-isolated: user B cannot list, edit or delete A's recipients", async () => {
    const a = await sessionFor(SENDER);
    const b = await sessionFor(STRANGER);
    const created = await (await createPOST(req("/api/recipients", { cookie: a.cookie, json: input }))).json();
    const id = created.recipient.id;
    expect(created.recipient.contactReference).toBe(input.contactReference);

    const listB = await (await listGET(req("/api/recipients", { cookie: b.cookie }))).json();
    expect(listB.recipients).toEqual([]);
    const patchB = await recPATCH(req(`/api/recipients/${id}`, { method: "PATCH", cookie: b.cookie, json: { displayName: "pwned" } }), params({ id }));
    expect(patchB.status).toBe(404);
    const delB = await recDELETE(req(`/api/recipients/${id}`, { method: "DELETE", cookie: b.cookie }), params({ id }));
    expect(delB.status).toBe(404);

    const listA = await (await listGET(req("/api/recipients", { cookie: a.cookie }))).json();
    expect(listA.recipients).toHaveLength(1);
    expect(listA.recipients[0].displayName).toBe("María López");

    const unauth = await listGET(req("/api/recipients"));
    expect(unauth.status).toBe(401);
  });

  it("stores the contact reference encrypted, never in plaintext", async () => {
    const a = await sessionFor(SENDER);
    await createPOST(req("/api/recipients", { cookie: a.cookie, json: input }));
    const [row] = await sql<{ contact_ciphertext: string }>`SELECT contact_ciphertext FROM recipients`;
    expect(row.contact_ciphertext.startsWith("v1:")).toBe(true);
    expect(row.contact_ciphertext).not.toContain("1234");
    expect(decryptContact(row.contact_ciphertext, a.userId)).toBe(input.contactReference);
  });

  it("validates input (delivery method vs country, wallet required for mezo_wallet, Nepal excluded)", async () => {
    const a = await sessionFor(SENDER);
    const sandboxUS = await createPOST(req("/api/recipients", { cookie: a.cookie, json: { ...input, country: "US", preferredDeliveryMethod: "local_payout_sandbox" } }));
    expect(sandboxUS.status).toBe(422);
    const noWallet = await createPOST(req("/api/recipients", { cookie: a.cookie, json: { ...input, walletAddress: null } }));
    expect(noWallet.status).toBe(400);
    const nepal = await createPOST(req("/api/recipients", { cookie: a.cookie, json: { ...input, country: "NP" } }));
    expect(nepal.status).toBe(422);
    const long = await createPOST(req("/api/recipients", { cookie: a.cookie, json: { ...input, contactReference: "x".repeat(201) } }));
    expect(long.status).toBe(400);
  });

  it("PATCH updates own recipient; null clears the contact; DELETE soft-deletes", async () => {
    const a = await sessionFor(SENDER);
    const { recipient } = await (await createPOST(req("/api/recipients", { cookie: a.cookie, json: input }))).json();
    const res = await recPATCH(
      req(`/api/recipients/${recipient.id}`, { method: "PATCH", cookie: a.cookie, json: { displayName: "María", contactReference: null } }),
      params({ id: recipient.id }),
    );
    const body = await res.json();
    expect(body.recipient.displayName).toBe("María");
    expect(body.recipient.contactReference).toBeNull();
    expect(body.recipient.walletAddress).toBe(RECIPIENT);
    expect((await recDELETE(req(`/api/recipients/${recipient.id}`, { method: "DELETE", cookie: a.cookie }), params({ id: recipient.id }))).status).toBe(200);
    expect((await (await listGET(req("/api/recipients", { cookie: a.cookie }))).json()).recipients).toEqual([]);
  });
});

describe("contact encryption", () => {
  it("round-trips and detects tampering, a wrong owner, and a wrong key", () => {
    const owner = "11111111-1111-1111-1111-111111111111";
    const blob = encryptContact("Signal @maria", owner);
    expect(decryptContact(blob, owner)).toBe("Signal @maria");
    expect(encryptContact("Signal @maria", owner)).not.toBe(blob); // fresh IV

    const [v, iv, tag, ct] = blob.split(":");
    const ctBuf = Buffer.from(ct, "base64");
    ctBuf[0] ^= 0x01;
    expect(() => decryptContact([v, iv, tag, ctBuf.toString("base64")].join(":"), owner)).toThrow();
    const tagBuf = Buffer.from(tag, "base64");
    tagBuf[3] ^= 0x80;
    expect(() => decryptContact([v, iv, tagBuf.toString("base64"), ct].join(":"), owner)).toThrow();
    expect(() => decryptContact(blob, "22222222-2222-2222-2222-222222222222")).toThrow();

    process.env.RECIPIENT_DATA_KEY = "ab".repeat(32);
    try {
      expect(() => decryptContact(blob, owner)).toThrow();
    } finally {
      delete process.env.RECIPIENT_DATA_KEY;
    }
  });

  it("refuses to run without RECIPIENT_DATA_KEY in production", () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      expect(() => encryptContact("x", "o")).toThrow(/RECIPIENT_DATA_KEY/);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prev;
    }
  });
});
