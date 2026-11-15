// Append-only audit trail for sensitive actions. Metadata must never contain PII (names, emails, contact refs,
// notes) or secrets (keys, signatures, cookies). Wallet addresses / tx hashes / ids are fine (public on-chain).
import type { Sql } from "./db";
import { clock } from "./clock";

export async function audit(tx: Sql, actor: string, action: string, resourceId: string | null, metadata: Record<string, unknown> = {}) {
  await tx`INSERT INTO audit_logs (actor, action, resource_id, metadata, created_at)
           VALUES (${actor}, ${action}, ${resourceId}, ${metadata}::jsonb, ${clock.now()})`;
}
