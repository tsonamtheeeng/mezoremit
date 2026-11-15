// AES-256-GCM for recipient contact references at rest.
// Format: v1:<iv b64>:<tag b64>:<ciphertext b64>. AAD binds the ciphertext to its owner, so a row copied to
// another user's recipient book fails to decrypt instead of leaking.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

let warned = false;

export function recipientDataKey(): Buffer {
  const raw = (process.env.RECIPIENT_DATA_KEY || "").trim().replace(/^0x/, "");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (env.isProd()) throw new Error("RECIPIENT_DATA_KEY must be a 32-byte hex string in production");
  if (!warned && !env.isTest()) {
    warned = true;
    console.warn("[crypto] RECIPIENT_DATA_KEY not set: using an insecure development key (never in production)");
  }
  return createHash("sha256").update("mezoremit-dev-only-recipient-data-key").digest();
}

const aad = (ownerId: string) => Buffer.from(`mezoremit:recipient:${ownerId}`);

export function encryptContact(plaintext: string, ownerId: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", recipientDataKey(), iv);
  c.setAAD(aad(ownerId));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

/** Throws on tampering, wrong key or wrong owner. */
export function decryptContact(blob: string, ownerId: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("unsupported ciphertext format");
  const [, ivB, tagB, ctB] = parts;
  const iv = Buffer.from(ivB, "base64");
  const tag = Buffer.from(tagB, "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("malformed ciphertext");
  const d = createDecipheriv("aes-256-gcm", recipientDataKey(), iv);
  d.setAAD(aad(ownerId));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(Buffer.from(ctB, "base64")), d.final()]).toString("utf8");
}
