import { z } from "zod";
import type { TransferResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route, uuidParam } from "@/lib/server/http";
import { markShared } from "@/lib/server/transfers";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(
  async (req, { sql, params }): Promise<TransferResponse> => {
    const s = await requireSession(sql, req);
    const { channel } = await parseBody(req, z.object({ channel: z.enum(["copy", "share_sheet", "qr"]) }));
    return { transfer: await markShared(sql, s, uuidParam(params.id), channel) };
  },
  { rateLimit: { bucket: "transfers-hint", limit: 30, windowSec: 60 } },
);
