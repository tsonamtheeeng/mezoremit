# Fiat rails and corridors (research notes, checked 2026-11-10)

> **Scope:** the MezoRemit MVP settles **on-chain only**: the sender sends or escrows MUSD on Mezo Testnet (31611) and
> the recipient receives or claims MUSD. There is no live fiat on-ramp, off-ramp or local-currency payout. Local-currency
> figures are **indicative reference rates**, not executable quotes. The payout flow uses a **simulated sandbox
> provider**, labelled as a simulation everywhere it appears. No money moves.

## Providers
| Provider | Mezo / MUSD support | Sandbox |
|---|---|---|
| Banxa | **Yes, on-ramp only** (buy MUSD on Mezo, announced 2025-12-09, mainnet). [mezo blog](https://mezo.org/blog/buy-musd-directly-with-your-card-banxa-is-live-on-mezo) | Requires sales onboarding. Accepts mainnet-format addresses only, and no on-chain tx happens. |
| Transak | No ("MUSD" there is MetaMask USD) | Self-serve staging key |
| MoonPay | No (`musd_mon` = MetaMask USD) | Partner account |
| Ramp Network | No | Demo key on request |
| Onramper | Routes to Banxa (unverified) | pk_test |
| Bitso Business (MX) | No | Sales-gated, SPEI payouts |

Mezo docs list Wormhole bridges (Mezo ↔ Ethereum/Base) and **no fiat off-ramp partner**. **No provider sandbox can
deliver Mezo-testnet MUSD**, so the MVP ships a provider-agnostic adapter layer plus a clearly labelled simulated
provider.

## FX reference
- Primary: `https://open.er-api.com/v6/latest/USD` (keyless). Updates every 24h. Cache for about 1h, because a 429
  locks out for 20 min. **Attribution is required**: show "Rates By Exchange Rate API" (link to exchangerate-api.com).
- Fallback: Frankfurter v2 `https://api.frankfurter.dev/v2/rates?base=USD&quotes=…` (blended official sources).
- MUSD is treated as ≈1 USD for indicative math, and the UI says so.

## Corridors
| Corridor | Status | MVP treatment |
|---|---|---|
| US→Mexico | Crypto is legal to hold. Banxico 4/2019 restricts banks and fintechs. Transak and MoonPay list MXN payout, Bitso offers SPEI. | `sandbox_payout`, **recommended pilot #1** |
| US→Philippines | BSP VASP licences are frozen for new entrants, so a licensed local partner is needed. Transak lists PHP payout. | `sandbox_payout`, pilot #2 |
| US→India | FIU-IND registration (including offshore providers), 1% TDS plus 30% tax | `onchain_only`, deferred |
| US→Nepal | **Prohibited**: NRB has declared crypto transactions illegal (2017–2023 notices) | **Excluded** from the destination list |

## US money transmission
FinCEN MSB registration (Form 107, within 180 days, renewed every 2 years). FIN-2019-G001 applies a facts-and-circumstances
test. State MTLs are required (35 states have adopted the MTMA, NY has the BitLicense). A testnet MVP with no real value
is out of scope. Any real-money pilot needs counsel review and a licensed partner first.
