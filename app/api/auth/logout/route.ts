import { clearSessionCookieHeader, destroySession, sessionFromRequest } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const POST = route(async (req, { sql }) => {
  const s = await sessionFromRequest(sql, req);
  if (s) await destroySession(sql, s.id);
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookieHeader() } });
});
