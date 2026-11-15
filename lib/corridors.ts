// Destination countries offered by MezoRemit (served by GET /api/countries). Source: docs/FIAT_AND_CORRIDORS.md.
//
// Every listed country can receive MUSD to a Mezo wallet (or via a claim link): that is the only real settlement in
// this MVP. "sandbox_payout" means a clearly labelled SIMULATED local-currency payout can be demoed there; no money
// moves and no licensed payout partner is integrated.
//
// Deliberately EXCLUDED:
//  - Nepal (NP): Nepal Rastra Bank has declared crypto transactions illegal (NRB notices 2017–2023, see
//    docs/FIAT_AND_CORRIDORS.md "Corridors"). We do not offer NP as a destination in any form.
//  - Any country where holding/receiving crypto is prohibited, and sanctioned jurisdictions. Absence from this list
//    means "not offered", not a legal opinion.
import type { Country } from "@/lib/api-types";

const WALLET_ONLY = "MUSD to a Mezo wallet only. No local-currency payout in this MVP.";

export const COUNTRIES: readonly Country[] = [
  {
    code: "MX",
    name: "Mexico",
    currency: "MXN",
    support: "sandbox_payout",
    note: "Pilot corridor. Local payout is a simulation (sandbox); no money moves.",
  },
  {
    code: "PH",
    name: "Philippines",
    currency: "PHP",
    support: "sandbox_payout",
    note: "Local payout is a simulation (sandbox); a real pilot needs a licensed local partner.",
  },
  { code: "US", name: "United States", currency: "USD", support: "onchain_only", note: WALLET_ONLY },
  { code: "CA", name: "Canada", currency: "CAD", support: "onchain_only", note: WALLET_ONLY },
  { code: "GB", name: "United Kingdom", currency: "GBP", support: "onchain_only", note: WALLET_ONLY },
  { code: "DE", name: "Germany", currency: "EUR", support: "onchain_only", note: WALLET_ONLY },
  { code: "FR", name: "France", currency: "EUR", support: "onchain_only", note: WALLET_ONLY },
  { code: "ES", name: "Spain", currency: "EUR", support: "onchain_only", note: WALLET_ONLY },
  {
    code: "IN",
    name: "India",
    currency: "INR",
    support: "onchain_only",
    note: "MUSD to a Mezo wallet only. Crypto income in India is taxed (30% plus 1% TDS); check local rules.",
  },
] as const;

/** Explicitly excluded destinations (code → reason), so the API can say why instead of "unknown country". */
export const EXCLUDED_COUNTRIES: Readonly<Record<string, string>> = {
  NP: "Nepal is not supported: Nepal Rastra Bank has declared crypto transactions illegal.",
};

export function findCountry(code: string | null | undefined): Country | null {
  if (!code) return null;
  const c = code.toUpperCase();
  return COUNTRIES.find((x) => x.code === c) ?? null;
}

export function supportsSandboxPayout(code: string): boolean {
  return findCountry(code)?.support === "sandbox_payout";
}
