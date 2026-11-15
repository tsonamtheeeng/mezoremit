import { z } from "zod";
import type { QuoteResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { createQuote } from "@/lib/server/quotes";

export const dynamic = "force-dynamic";

const zQuote = z.object({
  amount: z.string().max(80),
  destinationCountry: z.string().trim().length(2),
  deliveryMethod: z.enum(["mezo_wallet", "claim_link", "local_payout_sandbox"]),
});

export const POST = route(
  async (req, { sql }): Promise<QuoteResponse> => {
    const s = await requireSession(sql, req);
    const body = await parseBody(req, zQuote);
    return { quote: await createQuote(sql, s.userId, body) };
  },
  { rateLimit: { bucket: "quotes", limit: 60, windowSec: 60 } },
);
