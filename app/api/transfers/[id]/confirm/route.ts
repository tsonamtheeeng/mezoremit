import type { TransferResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { getChain } from "@/lib/server/chain";
import { route, uuidParam } from "@/lib/server/http";
import { confirmTransfer } from "@/lib/server/transfers";

export const dynamic = "force-dynamic";

/** Response: TransferResponse plus `result` (pending | confirming | confirmed | reverted | no_matching_event | nothing_to_confirm). */
export const POST = route<{ id: string }>(
  async (req, { sql, params }): Promise<TransferResponse & { result: string }> => {
    const s = await requireSession(sql, req);
    return confirmTransfer(sql, getChain(), s, uuidParam(params.id));
  },
  { rateLimit: { bucket: "transfers-confirm", limit: 60, windowSec: 60 } },
);
