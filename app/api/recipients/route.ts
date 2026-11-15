import type { RecipientInput, RecipientsResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { createRecipient, listRecipients, zRecipientInput } from "@/lib/server/recipients";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { sql }): Promise<RecipientsResponse> => {
  const s = await requireSession(sql, req);
  return { recipients: await listRecipients(sql, s.userId) };
});

export const POST = route(
  async (req, { sql }) => {
    const s = await requireSession(sql, req);
    const body = await parseBody(req, zRecipientInput);
    return { recipient: await createRecipient(sql, s.userId, body as RecipientInput) };
  },
  { rateLimit: { bucket: "recipients-write", limit: 30, windowSec: 60 } },
);
