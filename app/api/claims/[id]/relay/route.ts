import { z } from "zod";
import type { RelayClaimResponse } from "@/lib/api-types";
import { getChain, getRelayer } from "@/lib/server/chain";
import { relayClaim } from "@/lib/server/claims";
import { clientIp, parseBody, route, uuidParam } from "@/lib/server/http";
import { ipHash } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

const zRelay = z.object({ recipient: z.string().max(64), signature: z.string().max(200) });

export const POST = route<{ id: string }>(async (req, { sql, params }): Promise<RelayClaimResponse> => {
  const body = await parseBody(req, zRelay);
  return relayClaim(sql, getChain(), getRelayer(), uuidParam(params.id), body, ipHash(clientIp(req)));
});
