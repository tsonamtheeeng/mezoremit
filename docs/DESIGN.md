# MezoRemit design

Design read: a consumer remittance service for everyday senders and recipients, many of whom are new to wallets. It should feel
calm, credible and plain, more like a bank's transfer screen than a DeFi dashboard. Dials: variance 4, motion 3, density 4.

## Identity

| | Choice | Why |
|---|---|---|
| Base | "Stone" neutrals, a hair warm (OKLCH hue 85, chroma ≤ 0.006). Background `#fbfaf8`, ink ≈ `#1e1e1c` | Paper and ink. Warm enough to feel human, neutral enough to stay serious. Avoids the beige/brass "premium" cliché. |
| Accent | One cobalt, `oklch(0.49 0.165 262)` ≈ `#2759bc` | A confident, trustworthy blue used only for primary actions, focus, links and the active nav item. Nothing else is blue. |
| Display type | Schibsted Grotesk 500–700 (`font-display`) | A newspaper grotesk: clear and credible, with character in the numerals for amounts. |
| UI type | Public Sans (`font-sans`) | Designed for public services: legible at small sizes, neutral and accessible. |
| Mono | IBM Plex Mono (`font-mono`) | Addresses and hashes only. |
| Mark | Cobalt tile, an arrow crossing a dashed border line | Plain geometry, no illustration. `app/icon.svg`, `components/brand/logo.tsx`. |

Light theme is the default for everyone (`defaultTheme="light"`, system preference ignored). Dark theme is available in
Settings and has its own tokens.

## Tokens (`app/globals.css`)

- Surfaces: `background`, `surface` (sunken bands and notes), `card` (raised panels), `border`, `input`.
- Text: `foreground`, `muted-foreground` (AA on all surfaces).
- Brand: `brand`, `brand-ink` (link text), `brand-soft` (selected and active backgrounds), `brand-foreground`. `primary` aliases `brand`.
- Semantic, always paired with a word, never colour alone:
  - `ok` / `ok-soft`: verified on Mezo, delivered, claimed
  - `warn` / `warn-soft`: expired, needs action, bearer-link warning
  - `bad` / `bad-soft`: failed, errors
  - `sim` / `sim-soft` + the `sim-frame` utility (dashed border): every sandbox or simulated surface
  - `idle`: app-recorded steps, cancelled
- Radius rule: controls (buttons, inputs, small tags) are 8px (`rounded-md` or `rounded-lg`). Panels and sheets are 14px (`rounded-xl`). Only dots and step numbers are round.
- `num` utility: tabular lining figures for every amount, count and date.
- z-index scale: `--z-sticky 20`, `--z-dropdown 30`, `--z-overlay 40`, `--z-modal 50`, `--z-toast 60`.
- Motion: only two motivated animations. The hero preview fades in once, and the tx panel enters when a transaction starts. Both honour
  `prefers-reduced-motion`, and a global reduced-motion block disables transitions.

## Honesty rules baked into components

- **MUSD is not a bank payout.** The tracking page always says the transfer is MUSD on Mezo. The timeline splits into "MUSD on Mezo" and
  "Local payout (simulated)" lists. Status copy is unit-tested to never mention banks or payouts.
- **Timeline sources** (`components/transfer/timeline.tsx`, `lib/client/status.ts`):
  - `chain` → green check, "Verified on Mezo", with an explorer link
  - `app` → grey dot, "Recorded by MezoRemit"
  - `sandbox` → flask icon, dashed amber frame, "Simulated", with "(simulated)" appended to the title
- **Simulation labelling** (`components/shared/simulated-note.tsx`): `SimulatedNote` ("Simulation. No money moves.") is persistent and never
  dismissible. `SimulatedTag` goes next to any sandbox option.
- **Fees**: the review screen lists the transfer amount, network (Mezo), service fee (from the quote, 0.00 MUSD on testnet), network fee
  ("Paid by you in BTC", exact amount shown by the wallet), recipient receives, and the indicative local amount with reference rate, provider
  rate, markup, "Rates By Exchange Rate API" attribution and a quote countdown with refresh. There are no "zero fees" or "instant" claims.
- **Claim links are bearer secrets**: every place that shows a link carries the warning (anyone with it can claim, we can't recover it, cancel
  if it leaks). The landing and help pages say the same.
- **Testnet**: a global banner on every page. The landing page has a testnet section linking the BTC faucet and testnet MUSD.

## Screens

| Route | Purpose | Key states |
|---|---|---|
| `/` | Landing: hero, how it works, claim links, pricing, countries (live from `/api/countries`), security, testnet | countries loading / error / Nepal note |
| `/signin` | Connect → switch network → SIWE, with "new to wallets" guide | no wallet, wrong network, mismatched session |
| `/send` | Stepper: country → amount → recipient → delivery (+ link expiry) → review → wallet → done | balance loading, validation, quote loading / error / expired, create error, not deployed, wrong network, tx phases, claim key missing on resume |
| `/send?resume=<id>` | Finish funding an unfunded transfer | already sent |
| `/transfers/[id]` | Tracking: amount, status sentence, MUSD-not-bank note, sender actions, timeline, details, payout | loading, error, cancel/refund confirm, link available / not in this browser |
| `/claim/[transferId]` | Public claim page (`referrer: no-referrer`, noindex) | loading, invalid (missing / damaged / wrong key / not found), unavailable, not funded, expired, claim in progress, already claimed (by whom + tx), cancelled, refunded, claimable → connect / switch / claim (relay or self-paid) → success |
| `/dashboard` | Sender totals, recent transfers, saved recipients | loading, empty, error |
| `/received` | Live balance, received total, transfers, simulated payout options | loading, empty, error |
| `/history` | All transfers, direction + status filters, "Load more" via `nextCursor` | empty, no matches, error |
| `/recipients` | List, add, edit, delete (react-hook-form + zod) | empty, validation, delete confirm |
| `/payouts/[transferId]` | Sandbox payout: options → start → live lifecycle (polling) | not recipient, not received, no options, error |
| `/settings` | Display name, email, email notifications, show-name default, theme, sign out | validation, save errors |
| `/notifications` | Notification center (bell in header shows unread count) | empty, error |
| `/help` | FAQ (MUSD, claim links, fees, leaks, refunds, simulated, countries, testnet, custody) | |
| `404`, `error`, `global-error` | Plain recovery pages | |

Shell: a sticky header with a single-line desktop nav. On mobile, a 5-slot bottom nav (Activity, Send, Received, History, More) respects the
safe area.

## Transaction states (`hooks/use-tx.ts`, `components/shared/tx-panel.tsx`)

`idle → wallet (signature | transaction | none) → submitted (explorer link) → verifying (MezoRemit confirms) → confirmed`, or `error`.
Every phase is announced through an `aria-live` region. Errors come from `describeTxError` (`lib/client/errors.ts`): cancelled in wallet,
wrong network, not enough BTC for the network fee (with a faucet link), not enough MUSD (with a testnet MUSD link), decoded contract errors in
plain words, and RPC or API trouble.

Funding (`lib/client/writes.ts#fundTransfer`): if the allowance already covers the amount, it makes a plain call. Otherwise it uses an EIP-2612
permit (`MUSD_PERMIT_DOMAIN`, one free signature) with `sendDirectWithPermit` or `createClaimableWithPermit`. If the wallet can't sign permits,
it falls back to approve, then the call. The tx hash is posted to `/submitted` as soon as it's known. After the receipt the app calls `/confirm`
and polls until `awaiting_claim` or `completed`.

## Claim-key handling

- The key is generated with `newClaimKey()` in the browser **before** `POST /api/transfers`. Only `claimSigner` is sent.
- It is kept in memory, then in **sessionStorage** keyed by transfer id (`lib/client/claim-store.ts`). It is never put in localStorage and
  never sent to the API. The sender can remove it at any time. Closing the tab removes it.
- On the claim page the key is read from `location.hash` via `useSyncExternalStore`. It stays in the URL so a reload works, but it is never
  put in a request. `api()` sets `referrerPolicy: "no-referrer"`, and the route sets `<meta name="referrer" content="no-referrer">`.
- The claim signer is checked against chain (`transferIdByRef(sender, transferRef(id))` → `getTransfer`, record ref checked against the link) first, with the API as a fallback. The page
  still works if the backend is down.

## Accessibility

Skip link, visible cobalt focus ring, and native radio inputs for every choice card. Labels sit above inputs, with errors below and linked
via `aria-describedby`. Step changes move focus to the step heading. Tx and status changes are announced. Icons are `aria-hidden` with text
labels. Targets are at least 32px (most are 36–44px).
