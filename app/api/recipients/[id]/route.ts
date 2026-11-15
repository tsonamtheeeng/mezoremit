import type { RecipientInput } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route, uuidParam } from "@/lib/server/http";
import { deleteRecipient, updateRecipient, zRecipientPatch } from "@/lib/server/recipients";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(
  async (req, { sql, params }) => {
    const s = await requireSession(sql, req);
    const id = uuidParam(params.id);
    // Omitted fields stay as they are; explicit null clears walletAddress / contactReference.
    const patch = (await parseBody(req, zRecipientPatch)) as Partial<RecipientInput>;
    return { recipient: await updateRecipient(sql, s.userId, id, patch) };
  },
  { rateLimit: { bucket: "recipients-write", limit: 30, windowSec: 60 } },
);

export const DELETE = route<{ id: string }>(async (req, { sql, params }) => {
  const s = await requireSession(sql, req);
  await deleteRecipient(sql, s.userId, uuidParam(params.id));
  return { ok: true };
});
