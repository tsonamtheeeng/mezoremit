import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route, zUuid } from "@/lib/server/http";
import { markRead } from "@/lib/server/notify";

export const dynamic = "force-dynamic";

/** Body: { ids?: string[] } — omit ids to mark everything read. Response: { updated: number }. */
export const POST = route(async (req, { sql }) => {
  const s = await requireSession(sql, req);
  const { ids } = await parseBody(req, z.object({ ids: z.array(zUuid).max(200).optional() }));
  return { updated: await markRead(sql, s.userId, ids?.map((i) => i.toLowerCase())) };
});
