# MezoRemit API

All routes are JSON, under `/api`. Types live in `lib/api-types.ts` (FROZEN); this file explains behaviour, auth
and errors route by route. Amounts are **decimal strings of MUSD base units (18 decimals)** unless a field says
otherwise. Addresses are lowercase hex. Timestamps are ISO-8601.

## Conventions

**Auth.** `session` routes need the `mezoremit_session` cookie (httpOnly, `SameSite=Lax`, `Secure` in production,
HMAC-signed, 7-day DB session). Get it from `POST /api/auth/verify`. Missing or expired → `401 unauthorized`.

**Errors.** Every failure has the shape `{ "error": { "code": "...", "message": "...", "details"?: ... } }`.

| Status | Codes (examples) |
|---|---|
| 400 | `validation_error` (zod; `details` lists paths), `bad_request`, `invalid_amount`, `amount_too_large`, `self_transfer`, `recipient_wallet_required`, `claim_signer_required`, `invalid_claim_signer`, `invalid_expiry`, `invalid_request`, `invalid_cursor`, `invalid_recipient`, `invalid_claim_signature`, `email_required`, `wallet_required`, `invalid_payload` |
| 401 | `unauthorized`, SIWE: `address_mismatch`, `domain_mismatch`, `wrong_chain`, `invalid_message`, `message_expired`, `invalid_nonce`, `nonce_used`, `nonce_expired`, `invalid_signature`; claims: `invalid_proof`, `proof_stale`; webhooks: `invalid_signature` |
| 403 | `forbidden` (cross-site `Origin` on a state-changing request) |
| 404 | `not_found` (also for malformed ids and for anything you may not see — never 403, so probing reveals nothing) |
| 409 | `quote_expired` (`details.reason`: `not_found` / `expired` / `amount_mismatch` / `country_mismatch`), `not_funded`, `not_claimable`, `relay_in_progress`, `claim_would_fail`, `payout_exists` |
| 413 | `payload_too_large` |
| 422 | `country_unsupported`, `payout_unsupported`, `provider_unsupported`, `too_many_recipients` |
| 429 | `rate_limited` |
| 502 | `relay_failed` |
| 503 | `rates_unavailable`, `relay_unavailable`, `chain_unavailable` |

**Rate limits** are fixed windows in the `rate_limits` table, keyed by a keyed hash of the client IP (raw IPs are
never stored) and by session. Defaults: nonce/verify 20/min, quotes 60/min, transfer create 30/min, claim view
20 per 10 min per IP per link, relay 5 per 10 min per IP and 10/h per transfer.

**Authority rule.** Settlement state comes only from confirmed `RemittanceManager` logs (indexer or receipt
verifier, same ingest code). Client-reported tx hashes only move a transfer to `funding_submitted` /
`claim_submitted`. Payout state comes only from verified provider webhooks.

---

## Auth

### `POST /api/auth/nonce` — public
Body `{ address }` → `NonceResponse { nonce, message }`. `message` is an EIP-4361 message for chain 31611 with the
statement "Sign in to MezoRemit…", valid 10 min. In production the domain is pinned to `NEXT_PUBLIC_APP_URL`'s host
(+ `SIWE_EXTRA_DOMAINS`).

### `POST /api/auth/verify` — public
Body `{ address, message, signature }` (personal_sign of `message`; EOA, or ERC-1271/6492 smart account) →
`MeResponse` + `Set-Cookie`. The nonce is single-use (replay → `401 nonce_used`). On a wallet's first sign-in the
server backfills `transfer_received` notifications for MUSD that already reached that wallet.

### `POST /api/auth/logout` — session optional
Deletes the session, clears the cookie. `{ ok: true }`.

### `GET /api/auth/me` — session optional
`MeResponse` (`user: null` when signed out).

### `PATCH /api/settings` — session
Body `UpdateSettingsRequest`. `displayName` ≤ 40 chars (empty → null), `email` must be valid (lower-cased; null
clears it and turns email off), `emailNotifications: true` needs an email (`400 email_required`). → `MeResponse`.

## Countries

### `GET /api/countries` — public, cacheable
`CountriesResponse`. From `lib/corridors.ts`: MX and PH are `sandbox_payout` (simulated local payout demoable);
US, CA, GB, DE, FR, ES, IN are `onchain_only` (MUSD to a Mezo wallet). **Nepal is excluded** (Nepal Rastra Bank
prohibits crypto transactions); requests naming `NP` get `422 country_unsupported` with that reason.

## Recipients (owner-only)

Every query filters by the session user. Another user's recipient id → `404`. Max 200 per user.

| Route | Body | Response |
|---|---|---|
| `GET /api/recipients` | – | `RecipientsResponse` |
| `POST /api/recipients` | `RecipientInput` | `{ recipient: Recipient }` |
| `PATCH /api/recipients/:id` | partial `RecipientInput` (omitted = unchanged, `null` clears `walletAddress` / `contactReference`) | `{ recipient: Recipient }` |
| `DELETE /api/recipients/:id` | – | `{ ok: true }` (soft delete; contact ciphertext wiped) |

Rules: `displayName` 1–80, `country` must be listed, `walletAddress` a non-zero address, `contactReference` ≤ 200
chars. `mezo_wallet` needs a wallet (`400 wallet_required`); `local_payout_sandbox` only for MX/PH (`422`).
`contactReference` is AES-256-GCM encrypted with `RECIPIENT_DATA_KEY` (AAD = owner id) and decrypted only in the
owner's responses. It never appears on-chain, in claim endpoints, in notifications, or in audit logs.

## Quotes

### `POST /api/quotes` — session
Body `QuoteRequest { amount, destinationCountry, deliveryMethod }` → `QuoteResponse`.

- `kind` is always `"indicative"`: reference data, not executable. Expires 60 s after creation. Persisted in
  `transfer_quotes` with the caller's user id.
- `referenceRate`: USD → destination currency, live from open.er-api.com (attribution in `rateSource`:
  "Rates By Exchange Rate API…"), Frankfurter v2 as fallback, 1 h in-process cache. Never hardcoded. MUSD ≈ 1 USD.
- `deliveryMethod: "mezo_wallet" | "claim_link"` → provider `onchain`: `providerRate: null`, `fxMarkupBps: 0`,
  `recipientAmountLocal: null` (the reference rate is informational only).
- `deliveryMethod: "local_payout_sandbox"` (MX/PH only) → provider `sandbox`, label "MezoRemit Sandbox
  (simulated)": `providerRate = referenceRate × (1 − 150 bps)`, `fxMarkupBps: 150` (a disclosed **demo
  parameter**, not a real price), `recipientAmountLocal = amount × providerRate` (floored to 6 dp).
- `serviceFee: "0"`. `networkFeeNote` says gas is paid in BTC by whoever submits the tx; no invented numbers.
- Both FX sources down → `503 rates_unavailable` (the UI then offers MUSD-only).

Example:
```json
POST /api/quotes {"amount":"25000000000000000000","destinationCountry":"MX","deliveryMethod":"local_payout_sandbox"}
→ {"quote":{"kind":"indicative","referenceRate":"18.5824","providerRate":"18.303664","fxMarkupBps":150,
   "recipientAmountLocal":"457.5916","provider":"sandbox","providerLabel":"MezoRemit Sandbox (simulated)",
   "rateSource":"Rates By Exchange Rate API (https://www.exchangerate-api.com) via open.er-api.com", ...}}
```

## Transfers

### `POST /api/transfers` — session
Body `CreateTransferRequest` → `TransferResponse` (status `awaiting_funding`).

- **Idempotent** per `(user, idempotencyKey)`: the same key returns the existing transfer unchanged (even if the
  body differs). Keys are per user.
- The server generates the uuid first, then `ref = transferRef(id)`; use `transfer.ref` in the contract call.
- `amount`: positive integer string, ≤ 10,000,000 MUSD (`MANAGER_LIMITS.MAX_AMOUNT_MUSD`).
- `direct`: `recipientWallet` (or the saved recipient's wallet) required and ≠ your wallet; `claimSigner` /
  `expiresAt` must be omitted.
- `claim`: `recipientWallet` must be omitted; `claimSigner` required (browser-generated key address, not your
  wallet); `expiresAt` (unix seconds) within `[now + 60 s, now + 90 days]` inclusive. Note the contract checks
  `MIN_EXPIRY` against block time when the tx mines, so leave a margin.
- `recipientId` must be your own, non-deleted recipient (`404` otherwise).
- `quoteId` (optional) must be yours, unexpired, same amount and country → else `409 quote_expired`.
- `note` ≤ 280 chars (private; revealed to the claimer only with a link proof). `showSenderName` opts your display
  name onto the claim page.

### `GET /api/transfers?role=all|sent|received&cursor=&limit=` — session
`TransfersResponse`, newest first, `limit` 1–100 (default 20), opaque `nextCursor`. `sent` = yours; `received` =
direct transfers verified to your wallet, or claims you claimed.

### `GET /api/transfers/:id` — session
`TransferResponse`. Visible to the sender, and to the recipient once MUSD verifiably reached their wallet. Others
→ `404`. Perspective (`role`):
- `sender`: everything except the recipient's payout (`payout: null`, no `payout_*` timeline entries).
- `recipient`: no quote, no recipient-book data (`recipient.id`/`displayName` null); sees the note and their own
  `payout`.
- `status` is projected: `expired` = claim still funded on-chain and `expires_at` passed (never stored).

### `POST /api/transfers/:id/submitted` — session (sender)
Body `{ txHash }`. Records the funding hint (`funding_submitted`, timeline `funding_submitted` source `app`) unless
the chain already confirmed funding, then tries one fast receipt check. → `TransferResponse`.

### `POST /api/transfers/:id/confirm` — session (sender or recipient)
Re-verifies the pending hint now: fetches the receipt, ignores logs not emitted by `contracts.manager`, requires
`CONFIRMATIONS`, and runs the indexer's ingest. → `TransferResponse & { result }`, where `result` is
`pending | confirming | confirmed | reverted | no_matching_event | nothing_to_confirm`. RPC down →
`503 chain_unavailable`. A reverted funding receipt marks the transfer `failed`; a reverted claim receipt returns it
to `awaiting_claim`.

### `POST /api/transfers/:id/shared` — session (sender, claim only)
Body `MarkSharedRequest { channel }` → timeline `link_shared` (self-reported). → `TransferResponse`.

## Claims (link holder)

### `GET /api/claims/:id` — public
`ClaimInfo` only: transfer id, chain id, funding wallet (`senderAddress`, public on-chain), status, amount, expiry, claim signer, claimer, tx hashes, and
`relayAvailable` (relayer configured, funded above the gas threshold, and the transfer is `awaiting_claim`). **No
names, notes, countries, recipient-book or contact data.** Direct transfers → `404`.

### `POST /api/claims/:id/view` — claim-key proof
Body `ClaimViewRequest { issuedAt, signature }` where `signature = signViewProof(claimKey, id, issuedAt)`
(`lib/chain/claim.ts`). Must recover to the transfer's `claim_signer`, `issuedAt` within ±10 min. →
`ClaimViewResponse { senderDisplayName (only if opted in), note, destinationCountry }`.

### `POST /api/claims/:id/relay` — claim signature, rate-limited
Body `RelayClaimRequest { recipient, signature }` (`signature = signClaim(claimKey, manager, chainTransferId,
recipient)`). Preflight, all before any gas is spent: relayer configured and funded (`503 relay_unavailable`),
transfer funded (`409 not_funded`), chain `isClaimable` and not expired (`409 not_claimable`), EIP-712 signature
recovers to the on-chain `claimSigner` (`400 invalid_claim_signature`), no other relay in flight for this
transfer (`409 relay_in_progress`), `eth_call` simulation succeeds (`409 claim_would_fail`). Then the relayer sends
`claimTransfer`; the transfer moves to `claim_submitted`. → `RelayClaimResponse { txHash }`. Every attempt is
recorded in `relay_attempts` (rejected ones too).

### `POST /api/claims/:id/submitted` — public, rate-limited
Body `{ txHash }` for a recipient-paid claim. Hint only (`claim_submitted`), then a fast receipt check. →
`ClaimInfo`.

## Dashboards

### `GET /api/dashboard/sender` — session
`SenderDashboard`. `totals.pending` counts claims past expiry that are not refunded yet (funds still escrowed);
`totals.refunded` counts refunded **and** cancelled (funds back with the sender); `sentCompleted` sums completed +
claimed amounts. `recent` = last 10 sent; `recipients` = your book.

### `GET /api/dashboard/recipient` — session
`RecipientDashboard`: totals of verified receipts, `received` (role `recipient`), and `musdBalance` read live via
`balanceOf` (`null` if the RPC fails).

## Payouts (sandbox only, SIMULATED)

No money moves. Every payout row is `simulated: true`, every payout timeline entry is `source: "sandbox"`, and
`statusDetail` contains "Simulated — no money moved". On-chain `claimed` never implies a payout.

### `GET /api/payouts/options?transferId=` — session (recipient)
`PayoutOptionsResponse`. Only for a transfer that delivered MUSD to your wallet (claimed by you, or direct to you).
MX/PH → one option `{ provider: "sandbox", providerLabel: "MezoRemit Sandbox (simulated)", simulated: true, ... }`;
other countries → `[]`.

### `POST /api/payouts` — session (recipient)
Body `CreatePayoutRequest { transferId, provider: "sandbox" }` → `{ payout: PayoutRequest }` with status
`requested`. `payoutAmount` comes from a **fresh** sandbox quote of the received amount (`quoteId` is ignored). One
active payout per transfer (`409 payout_exists`); a new one is allowed after `failed`/`cancelled`.

### `GET /api/payouts/:id` — session (owner)
`{ payout: PayoutRequest }`.

Lifecycle: the worker's simulator posts **signed webhooks** to `/api/webhooks/sandbox`: `requested → processing`
≈10 s after the request, `processing → completed` ≈30 s after. Demo failure: a transfer amount ending in **.13
MUSD** (e.g. 25.13) fails at the last step. Nothing else can change payout status.

## Webhooks

### `POST /api/webhooks/:provider` — HMAC
Only `sandbox` exists. Header `x-sandbox-signature: t=<unix>,v1=<hex HMAC-SHA256(PROVIDER_WEBHOOK_SECRET_SANDBOX,
"<t>.<raw body>")>`, accepted within ±300 s. Body:
```json
{"id":"evt_<payout>_processing","type":"payout.processing|payout.completed|payout.failed",
 "createdAt":"…","data":{"payoutId":"<uuid>","providerReference":"sbx_…","detail":"…"}}
```
Invalid/stale signature → `401` (recorded under a random id, so the real event id is never burned). Idempotent by
`(provider, event id)`: a replay → `{ received: true, duplicate: true }`. Allowed transitions: `requested →
processing|failed`, `processing → completed|failed`; anything else is recorded as rejected and ignored
(`{ ignored: "invalid_transition" }`).

## Notifications

### `GET /api/notifications` — session
`NotificationsResponse` (latest 50 + unread count). `email` is the delivery status when email is configured and you
opted in (`queued | sent | failed`; `sent` = Resend accepted it and returned an id), `not_configured` if you opted in
but the server has no Resend key, else `null`. Bodies never contain claim links, keys, notes or contact references.

### `POST /api/notifications/read` — session
Body `{ ids?: string[] }` (omit to mark all read) → `{ updated: number }`.

## Ops

### `POST /api/indexer/sync` (also `GET`, for Vercel Cron) — `Authorization: Bearer INDEXER_SECRET`
Runs one full worker pass (indexer, sweeps, sandbox payouts, emails) and returns its result. Disabled (`404`) when
`INDEXER_SECRET` is empty; wrong token → `401`.

### `GET /api/health` — public
`HealthResponse`; `200` when the DB and RPC answer, `503` otherwise. `indexer.lagBlocks` = head − cursor.
`relayer.balanceBtc` is the relayer's BTC balance (decimal), when configured.

## Gaps against the frozen contract (implemented as compatible additions)

- `POST /api/transfers/:id/confirm` returns `TransferResponse` plus a `result` string.
- `POST /api/claims/:id/submitted` returns `ClaimInfo` (no response type is frozen).
- `POST /api/recipients` / `PATCH` return `{ recipient }`; `DELETE` returns `{ ok: true }`.
- `POST /api/payouts` / `GET /api/payouts/:id` return `{ payout }`.
- `POST /api/notifications/read` takes `{ ids?: string[] }` and returns `{ updated }`.
- `GET /api/transfers` accepts `role`, `cursor`, `limit` query params.
