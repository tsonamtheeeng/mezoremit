// In-app notifications (deduped by a unique key, so the indexer, the confirm endpoint and reconciliation can
// all call notify() for the same event) + optional email via Resend's REST API.
//
// Privacy: titles/bodies NEVER contain claim links, claim keys, notes, or contact references. Emails only point
// at the app root; the claim link exists only in the sender's browser.

import type { Notification, NotificationsResponse } from "@/lib/api-types";
import type { Sql } from "./db";
import { int, isoOrNull, iso, strOrNull } from "./db/rows";
import { addSeconds, clock } from "./clock";
import { env } from "./env";

export type NotificationType = Notification["type"];

export interface NotifyInput {
  userId: string;
  transferId: string | null;
  type: NotificationType;
  title: string;
  body: string;
  /** Unique; e.g. "<transfer>:<type>:<user>". Same key → no second notification. */
  dedupeKey: string;
}

/** Returns the notification id when newly created, null when deduped. */
export async function notify(tx: Sql, n: NotifyInput): Promise<string | null> {
  const now = clock.now();
  const [row] = await tx<{ id: string }>`
    INSERT INTO notifications (user_id, transfer_id, type, title, body, dedupe_key, created_at)
    VALUES (${n.userId}, ${n.transferId}, ${n.type}, ${n.title}, ${n.body}, ${n.dedupeKey}, ${now})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id`;
  if (!row) return null;
  if (env.emailConfigured()) {
    const [u] = await tx<{ email: string | null; notify_email: boolean }>`SELECT email, notify_email FROM users WHERE id = ${n.userId}`;
    if (u?.email && u.notify_email) {
      await tx`INSERT INTO notification_deliveries (notification_id, channel, status, next_attempt_at, created_at)
               VALUES (${row.id}, 'email', 'queued', ${now}, ${now}) ON CONFLICT (notification_id, channel) DO NOTHING`;
    }
  }
  return row.id;
}

// ---------------------------------------------------------------- API

export async function listNotifications(sql: Sql, userId: string, limit = 50): Promise<NotificationsResponse> {
  const rows = await sql<Record<string, unknown>>`
    SELECT n.id, n.transfer_id, n.type, n.title, n.body, n.read_at, n.created_at, d.status AS email_status,
           u.email AS user_email, u.notify_email
    FROM notifications n
    JOIN users u ON u.id = n.user_id
    LEFT JOIN notification_deliveries d ON d.notification_id = n.id AND d.channel = 'email'
    WHERE n.user_id = ${userId}
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT ${limit}`;
  const [c] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL`;
  const notifications: Notification[] = rows.map((r) => {
    let email: Notification["email"] = null;
    if (r.email_status) email = { status: r.email_status as "queued" | "sent" | "failed" };
    else if (r.user_email && r.notify_email && !env.emailConfigured()) email = { status: "not_configured" };
    return {
      id: String(r.id),
      transferId: strOrNull(r.transfer_id),
      type: r.type as NotificationType,
      title: String(r.title),
      body: String(r.body),
      readAt: isoOrNull(r.read_at),
      createdAt: iso(r.created_at),
      email,
    };
  });
  return { notifications, unread: int(c?.n) };
}

/** Mark the given ids (or all, when ids is omitted) read. Owner-scoped. */
export async function markRead(sql: Sql, userId: string, ids?: string[]): Promise<number> {
  const now = clock.now();
  if (ids && ids.length === 0) return 0;
  const rows = ids
    ? await sql<{ id: string }>`UPDATE notifications SET read_at = ${now}
        WHERE user_id = ${userId} AND read_at IS NULL AND id IN (${sql.join(ids.map((i) => sql.frag`${i}::uuid`), ", ")}) RETURNING id`
    : await sql<{ id: string }>`UPDATE notifications SET read_at = ${now} WHERE user_id = ${userId} AND read_at IS NULL RETURNING id`;
  return rows.length;
}

// ---------------------------------------------------------------- email delivery (worker)

export const EMAIL_MAX_ATTEMPTS = 5;
type FetchFn = typeof fetch;

/**
 * Send queued emails through Resend (POST https://api.resend.com/emails). A delivery is "sent" only when
 * Resend answers 2xx WITH an id; otherwise it is retried with exponential backoff (1, 2, 4, 8 min) and
 * marked "failed" after EMAIL_MAX_ATTEMPTS.
 */
export async function deliverEmails(sql: Sql, opts: { fetch?: FetchFn; limit?: number } = {}): Promise<{ sent: number; failed: number; retried: number }> {
  const out = { sent: 0, failed: 0, retried: 0 };
  if (!env.emailConfigured()) return out;
  const f = opts.fetch ?? fetch;
  const now = clock.now();
  const due = await sql<Record<string, unknown>>`
    SELECT d.id, d.attempts, n.title, n.body, u.email, u.notify_email
    FROM notification_deliveries d
    JOIN notifications n ON n.id = d.notification_id
    JOIN users u ON u.id = n.user_id
    WHERE d.channel = 'email' AND d.status = 'queued' AND d.next_attempt_at <= ${now}
    ORDER BY d.next_attempt_at ASC LIMIT ${opts.limit ?? 25}`;
  for (const d of due) {
    const id = String(d.id);
    const attempts = int(d.attempts) + 1;
    if (!d.email || !d.notify_email) {
      await sql`UPDATE notification_deliveries SET status = 'failed', attempts = ${attempts}, last_error = 'recipient opted out or has no email' WHERE id = ${id}`;
      out.failed++;
      continue;
    }
    let messageId: string | null = null;
    let error: string | null = null;
    try {
      const res = await f("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.resendApiKey()}`, "content-type": "application/json" },
        body: JSON.stringify({
          from: env.emailFrom(),
          to: [String(d.email)],
          subject: String(d.title),
          text: `${String(d.body)}\n\nOpen MezoRemit to see details: ${env.appUrl()}\n\nYou can turn these emails off in Settings.`,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: unknown; message?: unknown };
      if (res.ok && typeof body.id === "string" && body.id) messageId = body.id;
      else error = `resend ${res.status}: ${typeof body.message === "string" ? body.message.slice(0, 200) : "no id returned"}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 200);
    }
    if (messageId) {
      await sql`UPDATE notification_deliveries SET status = 'sent', provider_message_id = ${messageId}, attempts = ${attempts}, last_error = NULL WHERE id = ${id}`;
      out.sent++;
    } else if (attempts >= EMAIL_MAX_ATTEMPTS) {
      await sql`UPDATE notification_deliveries SET status = 'failed', attempts = ${attempts}, last_error = ${error} WHERE id = ${id}`;
      out.failed++;
    } else {
      const next = addSeconds(now, 60 * 2 ** (attempts - 1));
      await sql`UPDATE notification_deliveries SET attempts = ${attempts}, last_error = ${error}, next_attempt_at = ${next} WHERE id = ${id}`;
      out.retried++;
    }
  }
  return out;
}
