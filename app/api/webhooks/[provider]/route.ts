import { route } from "@/lib/server/http";
import { handleProviderWebhook } from "@/lib/server/webhooks";

export const dynamic = "force-dynamic";

export const POST = route<{ provider: string }>(
  async (req, { sql, params }) => {
    const raw = await req.text();
    return handleProviderWebhook(sql, String(params.provider || "").toLowerCase(), req.headers, raw);
  },
  { rateLimit: { bucket: "webhooks", limit: 300, windowSec: 60 } },
);
