# MezoRemit — Architecture (FROZEN)

> Send money across borders. Settle in MUSD.
> Changes to anything marked FROZEN go through the principal architect, not individual agents.

## 1. Components

| Layer | Where | Responsibility |
|---|---|---|
| Wallet + user | `lib/client/wagmi.ts`, `lib/server/auth.ts`, `/api/auth/*` | **Mezo Passport** connect (Bitcoin wallets Unisat/OKX/Xverse via a Mezo smart account, or Ethereum wallets); SIWE sign-in (EIP-4361, chain 31611) verified by ECDSA then ERC-1271/6492 for smart accounts; DB sessions in HMAC-signed httpOnly cookie |
| Remittance engine | `lib/server/transfers.ts`, `/api/transfers/*`, `/api/recipients/*` | Create transfers (idempotent), fee/quote attach, status projection, timeline |
| On-chain settlement | `contracts/src/RemittanceManager.sol` | Direct send, per-transfer escrow, claim (EIP-712 claim key), cancel, refund |
| Fiat integration | `lib/server/providers/*`, `/api/quotes`, `/api/payouts/*` | Provider-agnostic `QuoteProvider` / `OnRampProvider` / `OffRampProvider` / `PayoutProvider`; reference FX source; **sandbox provider labelled simulated** |
| Tracking + notify | `lib/server/indexer.ts`, `lib/server/notify.ts`, `worker/run.ts` | Event indexer (cursor, reorg window, idempotent), receipt verifier, reconciliation, in-app + optional email |

**Authority rule:** settlement state (`[chain]` columns) comes only from confirmed `RemittanceManager` logs
(indexer or `confirm` receipt verifier using the same ingest function). A client-reported tx hash only
moves a transfer to `funding_submitted` / `claim_submitted`. Fiat payout state comes only from the payout
provider (sandbox = simulated, labelled everywhere).

## 2. Transfer methods

**Direct** — `sendDirect(recipient, amount, ref)` pulls MUSD from sender to recipient in one tx. No custody.
On-chain record `Completed`.

**Claimable** — sender's browser generates an ephemeral claim key (`lib/chain/claim.ts`), calls
`createClaimable(claimSigner, amount, expiresAt, ref)` (create+fund atomic). Link =
`/claim/{appTransferId}#k={claimKey}`; key is in the fragment only (never sent to server). Recipient opens
link, connects wallet B, the page signs `Claim(transferId, recipientB)` with the claim key, and either:
- the **relayer** (`RELAYER_PRIVATE_KEY`, gas-only hot wallet) submits `claimTransfer` → recipient needs no BTC, or
- recipient submits it from wallet B (pays BTC gas).
The signature binds the recipient, so neither the relayer nor a mempool observer can redirect funds.
Sender can `cancelTransfer` any time before claim; after expiry anyone can `refundExpiredTransfer` (funds
always to sender). Trust assumption: **the link is a bearer instrument** — whoever holds it first can claim.
Share it privately; cancel if it leaks.

`ref = keccak256("mezoremit:transfer:" + uuid)`; the contract enforces a unique ref **per sender**
(`transferIdByRef(sender, ref)`), so nobody can copy a pending transfer's ref from the mempool and use it first
to block it. The indexer matches events to app transfers on (ref, sender) and ignores (audits) events from any
other sender, so a copied ref can neither fail nor complete someone else's transfer. The claim page resolves the
on-chain id with `transferIdByRef(senderAddress, ref)` and checks the record's ref against the link.

## 3. Status model

```
direct: awaiting_funding → funding_submitted → completed            (or failed)
claim:  awaiting_funding → funding_submitted → awaiting_claim → claim_submitted → claimed
                                                  │  ├→ cancelled
                                                  └→ expired (derived: now ≥ expiresAt, chain still Funded) → refunded | cancelled
payout (separate table, sandbox only): requested → processing → completed | failed
```
`expired` is a projection (`lib/server/status.ts`), not stored as chain truth. A funding tx hint with no
matching confirmed event after 30 min (or a reverted receipt) → `failed`. On-chain `Claimed` NEVER implies
a payout; payout rows/timeline are separate and marked `source: "sandbox"`.

## 4. API routes (all JSON, types in `lib/api-types.ts`)

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/auth/nonce` · `POST /api/auth/verify` · `POST /api/auth/logout` · `GET /api/auth/me` | – / session | SIWE |
| `PATCH /api/settings` | session | display name, email, email notifications |
| `GET /api/countries` | – | destination list with `support` level (from `lib/corridors.ts`) |
| `GET/POST /api/recipients` · `PATCH/DELETE /api/recipients/:id` | session (owner-only) | recipient book |
| `POST /api/quotes` | session | indicative quote (reference FX + provider rate + fees), expires 60 s |
| `GET/POST /api/transfers` · `GET /api/transfers/:id` | session | list own (sent + received), create, detail |
| `POST /api/transfers/:id/submitted` | session (sender) | funding tx hint → `funding_submitted`, then tries fast confirm |
| `POST /api/transfers/:id/confirm` | session | re-verify receipt now (same ingest as indexer) |
| `POST /api/transfers/:id/shared` | session (sender) | timeline `link_shared` |
| `GET /api/claims/:id` | public | `ClaimInfo` only (on-chain-public data + status) |
| `POST /api/claims/:id/view` | claim-key proof | sender display name (if opted in) + note |
| `POST /api/claims/:id/relay` | claim-key sig, rate-limited | relayer submits claim |
| `POST /api/claims/:id/submitted` | – | claim tx hint (recipient-paid path) |
| `GET /api/dashboard/sender` · `GET /api/dashboard/recipient` | session | dashboards (DB, reconciled) |
| `GET /api/payouts/options?transferId=` · `POST /api/payouts` · `GET /api/payouts/:id` | session (recipient) | sandbox payout lifecycle |
| `POST /api/webhooks/:provider` | HMAC (`PROVIDER_WEBHOOK_SECRET_<ID>`) | provider events, idempotent by event id |
| `GET /api/notifications` · `POST /api/notifications/read` | session | notification center |
| `POST /api/indexer/sync` | `Bearer INDEXER_SECRET` | cron fallback for one indexer pass |
| `GET /api/health` | – | `HealthResponse` |

Error shape: `{ error: { code, message } }`. Owner isolation: every recipient/transfer query filters by
`sender_user_id = session.userId` (or recipient wallet = session address for received views).

## 5. Ownership (parallel agents)

| Path | Owner |
|---|---|
| `contracts/**` | Contracts agent |
| `lib/server/**` (except FROZEN schema), `app/api/**`, `worker/**`, `lib/corridors.ts`, `scripts/**`, `tests/server/**` | Backend agent |
| `app/**` (except `app/api`), `components/**`, `hooks/**`, `lib/client/**`, `public/**`, `tests/ui/**` | Frontend agent |
| FROZEN: `contracts/src/interfaces/*`, `lib/chain/config.ts`, `lib/chain/claim.ts`, `lib/api-types.ts`, `lib/server/db/schema.sql`, this file | Architect |
| `lib/chain/abis.ts` | Contracts agent writes from `forge inspect` (must match interface) |

## 6. Env

See `.env.example`. Key split: `RELAYER_PRIVATE_KEY` (gas-only; web server, optional), `RECIPIENT_DATA_KEY`
(32-byte hex, AES-GCM for contact refs), `SESSION_SECRET`, `INDEXER_SECRET`, `DATABASE_URL`,
`RESEND_API_KEY` + `EMAIL_FROM` (optional), `PROVIDER_WEBHOOK_SECRET_SANDBOX`, `FX_REFERENCE_URL`.

## 7. Mezo Passport (wallets)

`@mezo-org/passport` 0.17.2 on wagmi 2 + RainbowKit 2 (`.npmrc` legacy-peer-deps: only Passport's config module is
loaded, which is React 19 safe). Bitcoin wallets act through a Mezo smart account (connector type `orangekit`):
- **Sign-in:** ECDSA recovery fails, so the server checks ERC-1271/6492 on chain. An RPC outage returns 503 `chain_unavailable`.
- **Sending:** MUSD's EIP-2612 permit needs an ECDSA owner signature, so smart accounts fund with approve + send
  (`fundingPath(..., smartAccount)`).
- **Claiming is unchanged:** the claim *key* signs the EIP-712 claim, not the wallet. MUSD lands at the connected smart account address.
