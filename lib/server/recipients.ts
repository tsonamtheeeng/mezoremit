// Recipient book: owner-scoped (every query filters by user_id), soft-deleted, contact reference encrypted at rest.

import { z } from "zod";
import type { Recipient, RecipientInput } from "@/lib/api-types";
import { findCountry, supportsSandboxPayout } from "@/lib/corridors";
import type { Sql } from "./db";
import { iso } from "./db/rows";
import { audit } from "./audit";
import { clock } from "./clock";
import { decryptContact, encryptContact } from "./crypto";
import { HttpError, notFound, unprocessable } from "./errors";

export const MAX_RECIPIENTS = 200;

const zAddr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");

export const zRecipientInput = z.object({
  displayName: z.string().trim().min(1).max(80),
  country: z.string().trim().length(2).transform((s) => s.toUpperCase()),
  walletAddress: zAddr.nullish().transform((v) => (v ? v.toLowerCase() : null)),
  preferredDeliveryMethod: z.enum(["mezo_wallet", "claim_link", "local_payout_sandbox"]),
  contactReference: z.string().trim().max(200).nullish().transform((v) => (v ? v : null)),
});
export const zRecipientPatch = zRecipientInput.partial();

type Parsed = z.infer<typeof zRecipientInput>;

function validate(r: Parsed) {
  if (!findCountry(r.country)) throw unprocessable("country_unsupported", "This destination country is not supported");
  if (r.preferredDeliveryMethod === "local_payout_sandbox" && !supportsSandboxPayout(r.country))
    throw unprocessable("payout_unsupported", "Local payout (sandbox) is only available for Mexico and the Philippines");
  if (r.preferredDeliveryMethod === "mezo_wallet" && !r.walletAddress)
    throw new HttpError(400, "wallet_required", "Add the recipient's Mezo wallet address to send directly");
  if (r.walletAddress && /^0x0{40}$/.test(r.walletAddress)) throw new HttpError(400, "invalid_address", "Invalid wallet address");
}

export function serializeRecipient(row: Record<string, unknown>, ownerId: string): Recipient {
  let contact: string | null = null;
  if (row.contact_ciphertext) {
    try {
      contact = decryptContact(String(row.contact_ciphertext), ownerId);
    } catch {
      contact = null; // tampered / wrong key: never surface ciphertext
      console.warn("[recipients] contact reference failed to decrypt", row.id);
    }
  }
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    country: String(row.country),
    walletAddress: row.wallet_address ? String(row.wallet_address) : null,
    preferredDeliveryMethod: row.preferred_delivery_method as Recipient["preferredDeliveryMethod"],
    contactReference: contact,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listRecipients(sql: Sql, userId: string): Promise<Recipient[]> {
  const rows = await sql<Record<string, unknown>>`
    SELECT * FROM recipients WHERE user_id = ${userId} AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ${MAX_RECIPIENTS}`;
  return rows.map((r) => serializeRecipient(r, userId));
}

export async function getOwnRecipient(sql: Sql, userId: string, id: string): Promise<Record<string, unknown>> {
  const [row] = await sql<Record<string, unknown>>`SELECT * FROM recipients WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL`;
  if (!row) throw notFound("Recipient not found");
  return row;
}

export async function createRecipient(sql: Sql, userId: string, input: RecipientInput): Promise<Recipient> {
  const r = zRecipientInput.parse(input);
  validate(r);
  const [{ n }] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM recipients WHERE user_id = ${userId} AND deleted_at IS NULL`;
  if (Number(n) >= MAX_RECIPIENTS) throw unprocessable("too_many_recipients", `You can save up to ${MAX_RECIPIENTS} recipients`);
  const now = clock.now();
  const [row] = await sql<Record<string, unknown>>`
    INSERT INTO recipients (user_id, display_name, country, wallet_address, preferred_delivery_method, contact_ciphertext, created_at, updated_at)
    VALUES (${userId}, ${r.displayName}, ${r.country}, ${r.walletAddress}, ${r.preferredDeliveryMethod},
            ${r.contactReference ? encryptContact(r.contactReference, userId) : null}, ${now}, ${now})
    RETURNING *`;
  await audit(sql, `user:${userId}`, "recipient_created", String(row.id), { country: r.country });
  return serializeRecipient(row, userId);
}

export async function updateRecipient(sql: Sql, userId: string, id: string, patch: Partial<RecipientInput>): Promise<Recipient> {
  const p = zRecipientPatch.parse(patch);
  const cur = serializeRecipient(await getOwnRecipient(sql, userId, id), userId);
  const merged: Parsed = {
    displayName: p.displayName ?? cur.displayName,
    country: p.country ?? cur.country,
    walletAddress: "walletAddress" in patch ? (p.walletAddress ?? null) : cur.walletAddress,
    preferredDeliveryMethod: p.preferredDeliveryMethod ?? cur.preferredDeliveryMethod,
    contactReference: "contactReference" in patch ? (p.contactReference ?? null) : cur.contactReference,
  };
  validate(merged);
  const [row] = await sql<Record<string, unknown>>`
    UPDATE recipients SET display_name = ${merged.displayName}, country = ${merged.country}, wallet_address = ${merged.walletAddress},
      preferred_delivery_method = ${merged.preferredDeliveryMethod},
      contact_ciphertext = ${merged.contactReference ? encryptContact(merged.contactReference, userId) : null}, updated_at = ${clock.now()}
    WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL
    RETURNING *`;
  if (!row) throw notFound("Recipient not found");
  await audit(sql, `user:${userId}`, "recipient_updated", id, { fields: Object.keys(p) });
  return serializeRecipient(row, userId);
}

export async function deleteRecipient(sql: Sql, userId: string, id: string): Promise<void> {
  const rows = await sql`UPDATE recipients SET deleted_at = ${clock.now()}, contact_ciphertext = NULL
                         WHERE id = ${id} AND user_id = ${userId} AND deleted_at IS NULL RETURNING id`;
  if (!rows.length) throw notFound("Recipient not found");
  await audit(sql, `user:${userId}`, "recipient_deleted", id);
}
