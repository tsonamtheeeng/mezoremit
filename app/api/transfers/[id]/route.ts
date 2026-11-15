import type { TransferResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { route, uuidParam } from "@/lib/server/http";
import { getTransferFor } from "@/lib/server/transfers";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { sql, params }): Promise<TransferResponse> => {
  const s = await requireSession(sql, req);
  return { transfer: await getTransferFor(sql, s, uuidParam(params.id)) };
});
