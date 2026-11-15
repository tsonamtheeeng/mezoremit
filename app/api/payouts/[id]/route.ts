import { requireSession } from "@/lib/server/auth";
import { route, uuidParam } from "@/lib/server/http";
import { getPayout } from "@/lib/server/payouts";

export const dynamic = "force-dynamic";

/** Response: { payout: PayoutRequest }. */
export const GET = route<{ id: string }>(async (req, { sql, params }) => {
  const s = await requireSession(sql, req);
  return { payout: await getPayout(sql, s, uuidParam(params.id)) };
});
