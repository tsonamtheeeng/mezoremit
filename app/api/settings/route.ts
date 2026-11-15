import type { MeResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { updateSettings, zSettings } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

export const PATCH = route(
  async (req, { sql }): Promise<MeResponse> => {
    const s = await requireSession(sql, req);
    const raw = await parseBody(req, zSettings.passthrough());
    return updateSettings(sql, s.userId, raw);
  },
  { rateLimit: { bucket: "settings", limit: 30, windowSec: 60 } },
);
