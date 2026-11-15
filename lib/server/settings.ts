import { z } from "zod";
import type { MeResponse } from "@/lib/api-types";
import type { Sql } from "./db";
import { iso } from "./db/rows";
import { audit } from "./audit";
import { HttpError } from "./errors";

export const zSettings = z.object({
  displayName: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .transform((v) => (v ? v : null)),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email())
    .nullish(),
  emailNotifications: z.boolean().optional(),
});

export async function me(sql: Sql, userId: string | null): Promise<MeResponse> {
  if (!userId) return { user: null };
  const [u] = await sql<Record<string, unknown>>`SELECT id, wallet_address, display_name, email, notify_email, created_at FROM users WHERE id = ${userId}`;
  if (!u) return { user: null };
  return {
    user: {
      id: String(u.id),
      address: String(u.wallet_address),
      displayName: (u.display_name as string | null) ?? null,
      email: (u.email as string | null) ?? null,
      emailNotifications: Boolean(u.notify_email),
      createdAt: iso(u.created_at),
    },
  };
}

export async function updateSettings(sql: Sql, userId: string, raw: unknown): Promise<MeResponse> {
  const input = zSettings.parse(raw);
  const [cur] = await sql<{ display_name: string | null; email: string | null; notify_email: boolean }>`
    SELECT display_name, email, notify_email FROM users WHERE id = ${userId}`;
  if (!cur) throw new HttpError(401, "unauthorized", "Sign in with your wallet first");
  const displayName = "displayName" in (raw as object) ? (input.displayName ?? null) : cur.display_name;
  const email = "email" in (raw as object) ? (input.email ?? null) : cur.email;
  let notifyEmail = input.emailNotifications ?? cur.notify_email;
  if (input.emailNotifications && !email) throw new HttpError(400, "email_required", "Add an email address to turn on email notifications");
  if (!email) notifyEmail = false;
  await sql`UPDATE users SET display_name = ${displayName}, email = ${email}, notify_email = ${notifyEmail} WHERE id = ${userId}`;
  await audit(sql, `user:${userId}`, "settings_updated", userId, {
    fields: Object.keys(raw as object).filter((k) => ["displayName", "email", "emailNotifications"].includes(k)),
  });
  return me(sql, userId);
}
