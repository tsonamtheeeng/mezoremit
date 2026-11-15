import { z } from "zod";
import type { TransferResponse, TransfersResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { parseBody, parseQuery, route } from "@/lib/server/http";
import { createTransfer, listTransfers, zCreateTransfer } from "@/lib/server/transfers";

export const dynamic = "force-dynamic";

const zList = z.object({
  role: z.enum(["all", "sent", "received"]).default("all"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = route(async (req, { sql }): Promise<TransfersResponse> => {
  const s = await requireSession(sql, req);
  const q = parseQuery(req, zList);
  return listTransfers(sql, s, q);
});

export const POST = route(
  async (req, { sql }): Promise<TransferResponse> => {
    const s = await requireSession(sql, req);
    const body = await parseBody(req, zCreateTransfer);
    return { transfer: await createTransfer(sql, s, body) };
  },
  { rateLimit: { bucket: "transfers-create", limit: 30, windowSec: 60 } },
);
