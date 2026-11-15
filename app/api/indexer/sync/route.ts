import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/server/env";
import { HttpError } from "@/lib/server/errors";
import { route } from "@/lib/server/http";
import { runWorkerPass } from "@/lib/server/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = env.indexerSecret();
  if (!secret) return false;
  const got = Buffer.from((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Cron fallback: one full worker pass (indexer + sweeps + sandbox payouts + emails). Bearer INDEXER_SECRET. */
async function handler(req: Request, { sql }: { sql: Parameters<typeof runWorkerPass>[0] }) {
  if (!env.indexerSecret()) throw new HttpError(404, "not_found", "Not found");
  if (!authorized(req)) throw new HttpError(401, "unauthorized", "Bad or missing indexer token");
  return runWorkerPass(sql, { name: "cron" });
}

export const POST = route(handler);
// Vercel Cron issues GET requests (with Authorization: Bearer $CRON_SECRET — set CRON_SECRET = INDEXER_SECRET).
export const GET = route(handler);
