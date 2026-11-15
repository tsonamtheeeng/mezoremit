import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { issueNonce, sessionFromRequest, SESSION_COOKIE, verifySignIn } from "@/lib/server/auth";
import { addSeconds, clock } from "@/lib/server/clock";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { HttpError } from "@/lib/server/errors";
import { updateSettings } from "@/lib/server/settings";
import { PATCH as settingsPATCH } from "@/app/api/settings/route";
import { POST as noncePOST } from "@/app/api/auth/nonce/route";
import { POST as verifyPOST } from "@/app/api/auth/verify/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { FakeChain, SENDER_KEY, req } from "./fakes";
import { T0 } from "./scenario";

const account = privateKeyToAccount(SENDER_KEY as Hex);
const origin = { domain: "localhost:3000", uri: "http://localhost:3000" };
const allowed = { allowedDomains: ["localhost:3000"] };
let sql: Sql;
let chain: FakeChain;

beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
  chain = new FakeChain();
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof HttpError ? e.code : String(e);
  }
}

describe("SIWE sign-in", () => {
  it("signs in once and rejects replay of the same nonce", async () => {
    const { message } = await issueNonce(sql, account.address, origin);
    expect(message).toContain("Sign in to MezoRemit");
    expect(message).toContain("Chain ID: 31611");
    const signature = await account.signMessage({ message });
    const s = await verifySignIn(sql, chain, { address: account.address, message, signature }, allowed);
    expect(s.address).toBe(account.address.toLowerCase());
    expect(await code(verifySignIn(sql, chain, { address: account.address, message, signature }, allowed))).toBe("nonce_used");
  });

  it("rejects a message created for another domain", async () => {
    const { message } = await issueNonce(sql, account.address, { domain: "evil.example", uri: "https://evil.example" });
    const signature = await account.signMessage({ message });
    expect(await code(verifySignIn(sql, chain, { address: account.address, message, signature }, allowed))).toBe("domain_mismatch");
  });

  it("rejects an expired message", async () => {
    const { message } = await issueNonce(sql, account.address, origin);
    const signature = await account.signMessage({ message });
    clock.set(() => addSeconds(T0, 601));
    expect(await code(verifySignIn(sql, chain, { address: account.address, message, signature }, allowed))).toBe("message_expired");
  });

  it("rejects a signature from another wallet", async () => {
    const { message } = await issueNonce(sql, account.address, origin);
    const other = privateKeyToAccount(("0x" + "dd".repeat(32)) as Hex);
    const signature = await other.signMessage({ message });
    expect(await code(verifySignIn(sql, chain, { address: account.address, message, signature }, allowed))).toBe("invalid_signature");
  });

  it("works end to end through the routes and sets the mezoremit_session cookie", async () => {
    const n = await noncePOST(req("/api/auth/nonce", { json: { address: account.address } }));
    const { message } = await n.json();
    const signature = await account.signMessage({ message });
    // Live chain adapter is only touched for smart-account sigs; EOA sig verifies locally.
    const v = await verifyPOST(req("/api/auth/verify", { json: { address: account.address, message, signature } }));
    expect(v.status).toBe(200);
    const cookie = v.headers.get("set-cookie")!;
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(cookie).toContain("HttpOnly");
    const meRes = await meGET(req("/api/auth/me", { cookie: cookie.split(";")[0] }));
    const body = await meRes.json();
    expect(body.user.address).toBe(account.address.toLowerCase());
    const s = await sessionFromRequest(sql, req("/", { cookie: cookie.split(";")[0] }));
    expect(s?.userId).toBe(body.user.id);
  });
});

describe("settings", () => {
  it("validates display name length and email, and requires an email for email notifications", async () => {
    const { message } = await issueNonce(sql, account.address, origin);
    const s = await verifySignIn(sql, chain, { address: account.address, message, signature: await account.signMessage({ message }) }, allowed);
    const cookie = `${SESSION_COOKIE}=${(await import("@/lib/server/auth")).signSessionId(s.id)}`;
    const bad = await settingsPATCH(req("/api/settings", { method: "PATCH", cookie, json: { displayName: "x".repeat(41) } }));
    expect(bad.status).toBe(400);
    const badEmail = await settingsPATCH(req("/api/settings", { method: "PATCH", cookie, json: { email: "not-an-email" } }));
    expect(badEmail.status).toBe(400);
    expect(await code(updateSettings(sql, s.userId, { emailNotifications: true }))).toBe("email_required");
    const ok = await settingsPATCH(req("/api/settings", { method: "PATCH", cookie, json: { displayName: "Ana", email: "Ana@Example.com", emailNotifications: true } }));
    const body = await ok.json();
    expect(body.user.displayName).toBe("Ana");
    expect(body.user.email).toBe("ana@example.com");
    const [u] = await sql<{ notify_email: boolean }>`SELECT notify_email FROM users WHERE id = ${s.userId}`;
    expect(u.notify_email).toBe(true);
  });
});
