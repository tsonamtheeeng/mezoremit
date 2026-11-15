// Route-handler glue: error mapping, zod parsing, rate limits, origin checks.
// (Transfer creation has its own idempotency via transfers (sender_user_id, idempotency_key).)
import "server-only";

import { z, ZodError } from "zod";
import type { ApiError } from "@/lib/api-types";
import { getDb, type Sql } from "./db";
import { env } from "./env";
import { HttpError, badRequest, forbidden } from "./errors";
import { readCookie, SESSION_COOKIE, unsignSessionCookie } from "./auth";
import { ipHash, rateLimit } from "./ratelimit";

export { rateLimit };

export interface RouteOptions {
  /** Requests per window per client (IP hash, and session id when signed in). */
  rateLimit?: { bucket: string; limit: number; windowSec?: number };
}

type Params = Record<string, string>;
type Handler<P extends Params> = (req: Request, ctx: { params: P; sql: Sql }) => Promise<unknown>;

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init.headers ?? {}) },
  });
}

function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    const body: ApiError = { error: { code: e.code, message: e.message, ...(e.details !== undefined ? { details: e.details } : {}) } };
    return json(body, { status: e.status });
  }
  if (e instanceof ZodError) {
    const body: ApiError = {
      error: {
        code: "validation_error",
        message: e.issues[0] ? `${e.issues[0].path.join(".") || "body"}: ${e.issues[0].message}` : "Invalid request",
        details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
    return json(body, { status: 400 });
  }
  console.error("[api] unhandled", e);
  const body: ApiError = { error: { code: "internal", message: "Something went wrong on our side. Please try again." } };
  return json(body, { status: 500 });
}

export function clientIp(req: Request): string {
  // x-real-ip is set by the platform proxy (Vercel/Render) and can't be prepended to by the client.
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim() || "unknown";
  return "unknown";
}

/** Reject cross-site state-changing requests (defence in depth on top of SameSite=Lax). */
function checkOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw forbidden("Bad origin");
  }
  const allowed = new Set<string>();
  const reqHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (reqHost) allowed.add(reqHost);
  try {
    allowed.add(new URL(env.appUrl()).host);
  } catch {
    /* ignore */
  }
  if (!allowed.has(host)) throw forbidden("Cross-site request blocked");
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    if (text.length > 64_000) throw badRequest("Request body too large");
    try {
      raw = JSON.parse(text);
    } catch {
      throw badRequest("Body must be JSON");
    }
  }
  return schema.parse(raw);
}

export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const url = new URL(req.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

/**
 * Sign-in domain/URI. In production the domain is pinned to NEXT_PUBLIC_APP_URL (plus optional
 * SIWE_EXTRA_DOMAINS, comma-separated, e.g. a Vercel preview host): request headers are never trusted there,
 * so a message signed on a phishing origin is rejected. In development the request host is accepted too.
 */
export function siweOrigin(req: Request): { domain: string; uri: string; allowedDomains: string[] } {
  const app = new URL(env.appUrl());
  const extra = (process.env.SIWE_EXTRA_DOMAINS || "").split(",").map((d) => d.trim()).filter(Boolean);
  if (process.env.NODE_ENV === "production") {
    return { domain: app.host, uri: app.origin, allowedDomains: Array.from(new Set([app.host, ...extra])) };
  }
  const reqHost = req.headers.get("host") || new URL(req.url).host;
  const proto = new URL(req.url).protocol.replace(":", "");
  return { domain: reqHost, uri: `${proto}://${reqHost}`, allowedDomains: Array.from(new Set([reqHost, app.host, ...extra])) };
}

export function route<P extends Params = Params>(fn: Handler<P>, opts: RouteOptions = {}) {
  return async (req: Request, ctx?: { params?: Promise<P> | P }): Promise<Response> => {
    try {
      checkOrigin(req);
      const sql = await getDb();
      const params = ((await ctx?.params) ?? {}) as P;
      const sessionId = unsignSessionCookie(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
      if (opts.rateLimit) {
        const { bucket, limit, windowSec } = opts.rateLimit;
        await rateLimit(sql, `${bucket}:ip:${ipHash(clientIp(req))}`, limit, windowSec);
        if (sessionId) await rateLimit(sql, `${bucket}:s:${sessionId.slice(0, 16)}`, limit, windowSec);
      }
      const result = await fn(req, { params, sql });
      if (result instanceof Response) return result;
      return json(result);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

// ---------------------------------------------------------------- shared zod pieces

export const zTxHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 32-byte 0x hash") as z.ZodType<`0x${string}`>;
export const zAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");
export const zConfirm = z.object({ txHash: zTxHash });
export const zUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a uuid");

/** 404 for malformed ids so probing never reveals anything. */
export function uuidParam(v: string | undefined): string {
  const r = zUuid.safeParse(v);
  if (!r.success) throw new HttpError(404, "not_found", "Not found");
  return r.data.toLowerCase();
}
