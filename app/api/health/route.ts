import type { HealthResponse } from "@/lib/api-types";
import { getChain, getRelayer } from "@/lib/server/chain";
import { getDb } from "@/lib/server/db";
import { health } from "@/lib/server/health";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const body: HealthResponse = await health(getDb, getChain(), getRelayer());
  return json(body, { status: body.ok ? 200 : 503 });
}
