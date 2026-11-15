import { z } from "zod";
import type { Hex } from "viem";
import type { MeResponse } from "@/lib/api-types";
import { sessionCookieHeader, verifySignIn } from "@/lib/server/auth";
import { getChain } from "@/lib/server/chain";
import { json, parseBody, route, siweOrigin, zAddress } from "@/lib/server/http";
import { me } from "@/lib/server/settings";

export const dynamic = "force-dynamic";

const zVerify = z.object({ address: zAddress, message: z.string().min(1).max(4000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(20_000) });

export const POST = route(
  async (req, { sql }) => {
    const body = await parseBody(req, zVerify);
    const session = await verifySignIn(sql, getChain(), { ...body, signature: body.signature as Hex }, { allowedDomains: siweOrigin(req).allowedDomains });
    const res: MeResponse = await me(sql, session.userId);
    return json(res, { headers: { "set-cookie": sessionCookieHeader(session.id, session.expiresAt) } });
  },
  { rateLimit: { bucket: "auth-verify", limit: 20, windowSec: 60 } },
);
