import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route, zUuid } from "@/lib/server/http";
import { createPayout } from "@/lib/server/payouts";

export const dynamic = "force-dynamic";

const zCreate = z.object({ transferId: zUuid, provider: z.string().min(1).max(40), quoteId: zUuid.nullish() });

/** Response: { payout: PayoutRequest }. The payout amount always comes from a fresh sandbox quote (quoteId is ignored). */
export const POST = route(
  async (req, { sql }) => {
    const s = await requireSession(sql, req);
    const body = await parseBody(req, zCreate);
    return { payout: await createPayout(sql, s, { transferId: body.transferId.toLowerCase(), provider: body.provider }) };
  },
  { rateLimit: { bucket: "payouts", limit: 10, windowSec: 60 } },
);
