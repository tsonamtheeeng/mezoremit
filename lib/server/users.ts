import type { Sql } from "./db";

/** Upsert a user by wallet. Returns { id, created } (created = first sign-in / first sighting). */
export async function ensureUser(tx: Sql, address: string): Promise<{ id: string; created: boolean }> {
  const a = address.toLowerCase();
  const [existing] = await tx<{ id: string }>`SELECT id FROM users WHERE wallet_address = ${a}`;
  if (existing) return { id: existing.id, created: false };
  const [row] = await tx<{ id: string }>`
    INSERT INTO users (wallet_address) VALUES (${a})
    ON CONFLICT (wallet_address) DO UPDATE SET wallet_address = EXCLUDED.wallet_address
    RETURNING id`;
  return { id: row.id, created: true };
}

export async function userIdByWallet(tx: Sql, address: string | null | undefined): Promise<string | null> {
  if (!address) return null;
  const [row] = await tx<{ id: string }>`SELECT id FROM users WHERE wallet_address = ${address.toLowerCase()}`;
  return row?.id ?? null;
}
