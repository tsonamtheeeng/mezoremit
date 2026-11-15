import { z } from "zod";
import type { PayoutOptionsResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { parseQuery, route, zUuid } from "@/lib/server/http";
import { payoutOptions } from "@/lib/server/payouts";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { sql }): Promise<PayoutOptionsResponse> => {
  const s = await requireSession(sql, req);
  const { transferId } = parseQuery(req, z.object({ transferId: zUuid }));
  return { options: await payoutOptions(sql, s, transferId.toLowerCase()) };
});
