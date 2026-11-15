import type { CountriesResponse } from "@/lib/api-types";
import { COUNTRIES } from "@/lib/corridors";
import { json } from "@/lib/server/http";

export const dynamic = "force-static";

export function GET(): Response {
  const body: CountriesResponse = { countries: [...COUNTRIES] };
  return json(body, { headers: { "cache-control": "public, max-age=300" } });
}
