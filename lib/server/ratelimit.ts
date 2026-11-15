// Fixed-window rate limiter backed by the `rate_limits` table (works across web instances + the worker).
import { createHmac } from "node:crypto";
import type { Sql } from "./db";
import { addSeconds, clock } from "./clock";
import { env } from "./env";
import { tooMany } from "./errors";

/** Increments `key` in the current window; throws 429 once the count exceeds `limit`. */
export async function rateLimit(sql: Sql, key: string, limit: number, windowSec = 60): Promise<void> {
  const now = clock.now();
  const cutoff = addSeconds(now, -windowSec);
  const [row] = await sql<{ count: number }>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${now}, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < ${cutoff}::timestamptz THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < ${cutoff}::timestamptz THEN ${now}::timestamptz ELSE rate_limits.window_start END
    RETURNING count`;
  if (Number(row?.count ?? 0) > limit) throw tooMany();
}

/** Keyed hash of a client IP so raw IPs are never stored (rate_limits keys, relay_attempts.ip_hash). */
export function ipHash(ip: string): string {
  return createHmac("sha256", env.sessionSecret()).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

/** Opportunistic cleanup of stale windows. */
export async function pruneRateLimits(sql: Sql, olderThanSec = 86400): Promise<void> {
  await sql`DELETE FROM rate_limits WHERE window_start < ${addSeconds(clock.now(), -olderThanSec)}`;
}
