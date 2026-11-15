import type { RecipientDashboard } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { getChain } from "@/lib/server/chain";
import { recipientDashboard } from "@/lib/server/dashboard";
import { route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { sql }): Promise<RecipientDashboard> => recipientDashboard(sql, getChain(), await requireSession(sql, req)));
