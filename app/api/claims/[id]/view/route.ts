import { z } from "zod";
import type { ClaimViewResponse } from "@/lib/api-types";
import { viewClaim } from "@/lib/server/claims";
import { clientIp, parseBody, route, uuidParam } from "@/lib/server/http";
import { ipHash } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

const zView = z.object({ issuedAt: z.number().int(), signature: z.string().max(200) });

export const POST = route<{ id: string }>(async (req, { sql, params }): Promise<ClaimViewResponse> => {
  const body = await parseBody(req, zView);
  return viewClaim(sql, uuidParam(params.id), body, ipHash(clientIp(req)));
});
