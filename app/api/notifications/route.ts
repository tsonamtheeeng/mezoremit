import type { NotificationsResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { listNotifications } from "@/lib/server/notify";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { sql }): Promise<NotificationsResponse> => {
  const s = await requireSession(sql, req);
  return listNotifications(sql, s.userId);
});
