import type { SenderDashboard } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { senderDashboard } from "@/lib/server/dashboard";
import { route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { sql }): Promise<SenderDashboard> => senderDashboard(sql, await requireSession(sql, req)));
