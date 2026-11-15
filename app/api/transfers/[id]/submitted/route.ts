import type { TransferResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { getChain } from "@/lib/server/chain";
import { parseBody, route, uuidParam, zConfirm } from "@/lib/server/http";
import { reportFunding } from "@/lib/server/transfers";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(
  async (req, { sql, params }): Promise<TransferResponse> => {
    const s = await requireSession(sql, req);
    const { txHash } = await parseBody(req, zConfirm);
    return { transfer: await reportFunding(sql, getChain(), s, uuidParam(params.id), txHash) };
  },
  { rateLimit: { bucket: "transfers-hint", limit: 30, windowSec: 60 } },
);
