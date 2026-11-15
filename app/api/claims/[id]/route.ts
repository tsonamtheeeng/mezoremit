import type { ClaimInfo } from "@/lib/api-types";
import { getChain, getRelayer } from "@/lib/server/chain";
import { getClaimInfo } from "@/lib/server/claims";
import { route, uuidParam } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Public: on-chain-public data + status only. No names, notes or recipient-book data. */
export const GET = route<{ id: string }>(
  async (_req, { sql, params }): Promise<ClaimInfo> => getClaimInfo(sql, getChain(), getRelayer(), uuidParam(params.id)),
  { rateLimit: { bucket: "claims-read", limit: 120, windowSec: 60 } },
);
