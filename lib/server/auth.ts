// Wallet sign-in (SIWE-style, EIP-4361 text) + DB-backed sessions in an HMAC-signed httpOnly cookie.
// Framework-free so it is unit-testable; Next request/response glue lives in ./http.ts.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";
import { MEZO_TESTNET_ID } from "@/lib/chain/config";
import type { Sql } from "./db";
import { verifyWalletSignature, type ChainAdapter } from "./chain";
import { addSeconds, clock } from "./clock";
import { env } from "./env";
import { HttpError, unauthorized } from "./errors";
import { ensureUser } from "./users";
import { backfillReceivedNotifications } from "./messages";

export const SESSION_COOKIE = "mezoremit_session";
export const NONCE_TTL_SECONDS = 600;
export const SESSION_TTL_SECONDS = 7 * 86400;
const CLOCK_SKEW_SECONDS = 120;
export const SIGN_IN_STATEMENT = "Sign in to MezoRemit. This proves you own this wallet; it does not send a transaction or cost anything.";

export interface Session {
  id: string;
  userId: string;
  address: string; // lowercase
  expiresAt: Date;
}

export function normalizeAddress(a: string): string {
  if (typeof a !== "string" || !isAddress(a, { strict: false })) throw new HttpError(400, "invalid_address", "Invalid wallet address");
  return a.toLowerCase();
}

/** Creates a single-use nonce and the exact message the wallet must personal_sign. */
export async function issueNonce(sql: Sql, address: string, origin: { domain: string; uri: string }): Promise<{ nonce: string; message: string }> {
  const addr = normalizeAddress(address);
  const nonce = randomBytes(16).toString("hex");
  const now = clock.now();
  const expires = addSeconds(now, NONCE_TTL_SECONDS);
  await sql`INSERT INTO auth_nonces (nonce, address, expires_at) VALUES (${nonce}, ${addr}, ${expires})`;
  // Opportunistic cleanup.
  await sql`DELETE FROM auth_nonces WHERE expires_at < ${addSeconds(now, -86400)}`;
  const message = createSiweMessage({
    domain: origin.domain,
    address: getAddress(addr),
    statement: SIGN_IN_STATEMENT,
    uri: origin.uri,
    version: "1",
    chainId: MEZO_TESTNET_ID,
    nonce,
    issuedAt: now,
    expirationTime: expires,
  });
  return { nonce, message };
}

export interface VerifyInput {
  address: string;
  message: string;
  signature: Hex;
}

/**
 * Verifies the signed message and opens a session. Checks: message fields (domain ∈ allowed, version 1,
 * chainId 31611, address == claimed address, not expired, issuedAt not in the future), nonce exists for that
 * address / unexpired / unused, signature valid (EOA, then ERC-1271/6492), then consumes the nonce atomically.
 */
export async function verifySignIn(
  sql: Sql,
  chain: ChainAdapter,
  input: VerifyInput,
  opts: { allowedDomains: string[] },
): Promise<Session> {
  const addr = normalizeAddress(input.address);
  if (typeof input.message !== "string" || input.message.length > 4000) throw new HttpError(400, "invalid_message", "Invalid sign-in message");
  const fields = parseSiweMessage(input.message);
  const fail = (code: string, msg: string) => new HttpError(401, code, msg);
  if (!fields.address || fields.address.toLowerCase() !== addr) throw fail("address_mismatch", "Message address does not match");
  if (!fields.domain || !opts.allowedDomains.map((d) => d.toLowerCase()).includes(fields.domain.toLowerCase()))
    throw fail("domain_mismatch", "Message was created for a different site");
  if (fields.version !== "1") throw fail("invalid_message", "Unsupported message version");
  if (fields.chainId !== MEZO_TESTNET_ID) throw fail("wrong_chain", "Message is for a different chain");
  if (!fields.nonce) throw fail("invalid_message", "Message has no nonce");
  if (fields.statement !== SIGN_IN_STATEMENT) throw fail("invalid_message", "Unexpected sign-in statement");
  const now = clock.now();
  if (!fields.expirationTime || fields.expirationTime.getTime() <= now.getTime()) throw fail("message_expired", "Sign-in message expired; try again");
  if (!fields.issuedAt || fields.issuedAt.getTime() > now.getTime() + CLOCK_SKEW_SECONDS * 1000)
    throw fail("invalid_message", "Message issued in the future");

  const [n] = await sql<{ address: string; expires_at: Date; used_at: Date | null }>`
    SELECT address, expires_at, used_at FROM auth_nonces WHERE nonce = ${fields.nonce}`;
  if (!n || n.address !== addr) throw fail("invalid_nonce", "Unknown sign-in nonce; request a new one");
  if (n.used_at) throw fail("nonce_used", "This sign-in message was already used");
  if (new Date(n.expires_at).getTime() <= now.getTime()) throw fail("nonce_expired", "Sign-in nonce expired; try again");

  if (!/^0x[0-9a-fA-F]+$/.test(input.signature ?? "")) throw fail("invalid_signature", "Invalid signature");
  const ok = await verifyWalletSignature(chain, getAddress(addr) as Address, input.message, input.signature);
  if (!ok) throw fail("invalid_signature", "Signature does not match the wallet");

  // Single use: consume atomically (a concurrent replay loses this race).
  const consumed = await sql<{ nonce: string }>`
    UPDATE auth_nonces SET used_at = ${now} WHERE nonce = ${fields.nonce} AND used_at IS NULL AND expires_at > ${now}
    RETURNING nonce`;
  if (consumed.length === 0) throw fail("nonce_used", "This sign-in message was already used");

  const { id: userId, created } = await ensureUser(sql, addr);
  // Recipients who never signed in before get "transfer_received" for what already reached their wallet.
  if (created) await backfillReceivedNotifications(sql, userId, addr).catch(() => undefined);
  const id = randomBytes(32).toString("hex");
  const expiresAt = addSeconds(now, SESSION_TTL_SECONDS);
  await sql`INSERT INTO sessions (id, user_id, address, expires_at, created_at) VALUES (${id}, ${userId}, ${addr}, ${expiresAt}, ${now})`;
  await sql`DELETE FROM sessions WHERE expires_at < ${now}`;
  return { id, userId, address: addr, expiresAt };
}

// ---------------------------------------------------------------- cookie signing

function mac(id: string): string {
  return createHmac("sha256", env.sessionSecret()).update(`session:${id}`).digest("base64url");
}

export function signSessionId(id: string): string {
  return `${id}.${mac(id)}`;
}

export function unsignSessionCookie(value: string | undefined | null): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(id));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  return /^[0-9a-f]{64}$/.test(id) ? id : null;
}

export function sessionCookieHeader(id: string, expiresAt: Date): string {
  const parts = [
    `${SESSION_COOKIE}=${signSessionId(id)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor((expiresAt.getTime() - clock.now().getTime()) / 1000))}`,
  ];
  if (env.isProd()) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${env.isProd() ? "; Secure" : ""}`;
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export async function sessionFromRequest(sql: Sql, req: Request): Promise<Session | null> {
  const id = unsignSessionCookie(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
  if (!id) return null;
  const [row] = await sql<{ id: string; user_id: string; address: string; expires_at: Date }>`
    SELECT id, user_id, address, expires_at FROM sessions WHERE id = ${id}`;
  if (!row || new Date(row.expires_at).getTime() <= clock.now().getTime()) return null;
  return { id: row.id, userId: row.user_id, address: row.address, expiresAt: new Date(row.expires_at) };
}

export async function requireSession(sql: Sql, req: Request): Promise<Session> {
  const s = await sessionFromRequest(sql, req);
  if (!s) throw unauthorized();
  return s;
}

export async function destroySession(sql: Sql, id: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE id = ${id}`;
}
