import type { ClaimInfo } from "@/lib/api-types";
import { getChain, getRelayer } from "@/lib/server/chain";
import { reportClaimTx } from "@/lib/server/claims";
import { clientIp, parseBody, route, uuidParam, zConfirm } from "@/lib/server/http";
import { ipHash } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

/** Recipient-paid claim tx hint. Response: ClaimInfo (status claim_submitted until the receipt is verified). */
export const POST = route<{ id: string }>(async (req, { sql, params }): Promise<ClaimInfo> => {
  const { txHash } = await parseBody(req, zConfirm);
  return reportClaimTx(sql, getChain(), getRelayer(), uuidParam(params.id), txHash, ipHash(clientIp(req)));
});
