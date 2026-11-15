import { z } from "zod";
import type { NonceResponse } from "@/lib/api-types";
import { issueNonce } from "@/lib/server/auth";
import { parseBody, route, siweOrigin, zAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const POST = route(
  async (req, { sql }): Promise<NonceResponse> => {
    const { address } = await parseBody(req, z.object({ address: zAddress }));
    const o = siweOrigin(req);
    return issueNonce(sql, address, { domain: o.domain, uri: o.uri });
  },
  { rateLimit: { bucket: "auth-nonce", limit: 20, windowSec: 60 } },
);
