import type { MeResponse } from "@/lib/api-types";
import { sessionFromRequest } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { me } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { sql }): Promise<MeResponse> => {
  const s = await sessionFromRequest(sql, req);
  return me(sql, s?.userId ?? null);
});
