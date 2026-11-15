# MezoRemit — Operations

Topology: **web + API on Vercel** (Next.js), **background worker on Render** (`render.yaml`), **Postgres on Neon**
(shared `DATABASE_URL`). Chain: Mezo Testnet 31611. Without `DATABASE_URL` everything runs on an embedded PGlite
store (`.data/pglite`) — single process only, local development and tests.

## Environment variables

| Var | Where | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_MEZO_RPC_URL` | web + worker | – | default `https://rpc.test.mezo.org` |
| `NEXT_PUBLIC_MUSD_ADDRESS` | web + worker | – | default testnet MUSD `0x1189…c503` |
| `NEXT_PUBLIC_MANAGER_ADDRESS` | web + worker | yes (after deploy) | RemittanceManager; unset → indexer idle, `deployed: false` |
| `NEXT_PUBLIC_DEPLOY_BLOCK` | web + worker | yes | indexer starts here |
| `NEXT_PUBLIC_APP_URL` | web + worker | yes (prod) | pins the SIWE domain; base for the sandbox webhook URL |
| `DATABASE_URL` | web + worker | yes (prod) | Postgres URL (`prepare: false`). Neon pooled, or Supabase **session** pooler (port 5432) |
| `DB_SCHEMA` | web + worker | no | Own schema (e.g. `mezoremit`) when the database is shared with other apps; created on boot and used as `search_path` |
| `SESSION_SECRET` | web (+ worker) | yes (prod, ≥ 32 chars) | cookie HMAC, IP-hash key. Production throws if missing |
| `RECIPIENT_DATA_KEY` | web | yes (prod) | 32-byte hex, AES-256-GCM for contact references. Production throws if missing. **Losing it makes stored contact references unreadable** |
| `INDEXER_SECRET` | web | optional | Bearer for `/api/indexer/sync`; empty disables it |
| `CRON_SECRET` | web (Vercel) | optional | set equal to `INDEXER_SECRET` when using Vercel Cron |
| `RELAYER_PRIVATE_KEY` | **web only** | optional | gas-only hot wallet for claim relays. Never on the worker, never holds MUSD |
| `RELAYER_MIN_BALANCE_WEI` | web | optional | override of the "relayer can afford a claim" threshold (default gas price × 250k × 2) |
| `PROVIDER_WEBHOOK_SECRET_SANDBOX` | web + worker | yes (prod, ≥ 16 chars) | HMAC for simulated payout webhooks; must match on both. Missing in prod → sandbox payouts never advance and webhooks are rejected |
| `FX_REFERENCE_URL` / `FX_FALLBACK_URL` | web | – | defaults open.er-api.com / Frankfurter v2 |
| `RESEND_API_KEY` + `EMAIL_FROM` | worker (+ web) | optional | both set → emails for opted-in users |
| `CONFIRMATIONS` | web + worker | – | default 2 |
| `WORKER_INTERVAL_MS` | worker | – | default 10000 |
| `RECONCILE_EVERY` | worker | – | default 20 passes |
| `REORG_WINDOW` | worker | – | default 20 blocks |
| `FUNDING_TIMEOUT_SECONDS` | worker | – | default 1800 |
| `SANDBOX_PROCESSING_AFTER_SECONDS` / `SANDBOX_COMPLETE_AFTER_SECONDS` / `SANDBOX_WEBHOOK_URL` | worker | – | 10 / 30 / `${APP_URL}/api/webhooks/sandbox` |
| `SIWE_EXTRA_DOMAINS` | web | – | extra accepted sign-in hosts (e.g. a preview domain) |

Generate secrets with `openssl rand -hex 32`. Never commit real keys; `SENDER_PRIVATE_KEY` /
`RECIPIENT_PRIVATE_KEY` / `DEPLOYER_PRIVATE_KEY` are for scripts only.

## Database (Neon)

1. Create a Neon project + database; copy the **pooled** connection string into `DATABASE_URL` on Vercel and Render.
2. Schema (`lib/server/db/schema.sql`) is idempotent and applied on every boot under an advisory lock, so web and
   worker can start in any order. Manual: `npm run db:migrate`.
3. Backups: Neon point-in-time restore. The chain is the source of truth for settlement; after a restore, the
   worker's reconciliation re-derives `[chain]` columns from `getTransfer`.

## Worker (Render)

`render.yaml` defines `mezoremit-worker` (`npm run worker`). Each pass, every `WORKER_INTERVAL_MS`:

1. **Indexer** — cursor in `indexer_cursor` (starts at `NEXT_PUBLIC_DEPLOY_BLOCK − 1`), processes up to
   `head − CONFIRMATIONS` in `getLogs` chunks of ≤ 2,000 blocks (≤ 20,000 per pass), stores block hashes in
   `indexer_blocks`, applies events idempotently. **Reorgs**: if the stored hash of the cursor block (or of a
   recently applied block) differs from the chain, it rewinds `REORG_WINDOW` blocks, marks those
   `blockchain_events` `removed`, drops their chain-derived timeline/claim rows, re-derives the affected transfers
   from `getTransfer`, and re-indexes.
2. **Reconciliation** (every `RECONCILE_EVERY` passes) — re-reads `getTransfer` for transfers in non-terminal chain
   states / pending hints and corrects drift (`audit_logs.action = 'chain_drift'`).
3. **Expiry sweep** — funded claims past `expires_at` get a timeline entry and one sender notification.
4. **Pending hints** — funding hints: reverted receipt or no confirmed event after 30 min → `failed`; reverted claim
   → back to `awaiting_claim`; relay attempts → confirmed/reverted.
5. **Sandbox payout simulator** — posts signed webhooks to the web app (falls back to in-process handling if the web
   app is unreachable). SIMULATED: no money moves.
6. **Emails** — Resend REST, exponential backoff (1, 2, 4, 8 min), `failed` after 5 attempts.
7. **Heartbeat** — `worker_heartbeat` row `worker`.

Failing passes back off exponentially (capped at 2 min). `SIGTERM` finishes the current pass, then exits.
`npm run worker:once` runs a single pass (exit code 1 if any step failed). PGlite is single-process, so to run
`npm run dev` and `npm run worker` side by side locally, point both at a Postgres `DATABASE_URL`; with PGlite only,
run the web app alone and drive passes with `POST /api/indexer/sync` (the UI's confirm calls cover tx receipts).

## Vercel (web) + cron fallback

Deploy the Next.js app on Vercel with the web env vars. If the Render worker is down (or for a worker-less demo),
Vercel Cron can drive passes: add to `vercel.json`

```json
{ "crons": [{ "path": "/api/indexer/sync", "schedule": "* * * * *" }] }
```

and set `CRON_SECRET` = `INDEXER_SECRET` (Vercel sends `Authorization: Bearer $CRON_SECRET` on a GET; the route
accepts GET and POST). Per-minute crons need a paid plan; on Hobby use an external pinger with the bearer header.
The UI also calls `/api/transfers/:id/confirm` after each tx, so funding/claims confirm without the worker.

## Health

`GET /api/health` → `200` when DB + RPC answer, else `503`. Watch:
- `indexer.lagBlocks` — should hover around `CONFIRMATIONS`; growing = worker down or RPC failing.
- `indexer.updatedAt` / `worker_heartbeat.updated_at` — stale > 2 min = worker not running.
- `relayer.balanceBtc` — top up before it falls under the threshold; below it `relayAvailable` turns false and
  recipients pay their own gas (no outage, just worse UX).

## Relayer funding

The relayer (`RELAYER_PRIVATE_KEY`) only pays gas for `claimTransfer`; it cannot redirect funds (the claim
signature binds the recipient) and should never hold MUSD. Fund it with a small amount of testnet BTC (Mezo
faucet) from a separate wallet, watch `relayer.balanceBtc`, and rotate the key by replacing the env var and
redeploying (no on-chain role to change). Abuse is bounded by per-IP / per-transfer rate limits, one in-flight relay
per transfer, and the off-chain signature + simulation preflight (bad requests never cost gas).

## Recovery runbook

| Symptom | Action |
|---|---|
| Transfers stuck in `funding_submitted` | Check RPC; `POST /api/transfers/:id/confirm`; after 30 min they fail automatically, and a later on-chain event still moves them forward (chain wins). |
| Indexer stuck / lag growing | Render logs; RPC health; run `npm run worker:once` locally against `DATABASE_URL` to see the failing step. |
| Need to re-index a range | `UPDATE indexer_cursor SET last_block = <block-1>, last_block_hash = NULL WHERE name = 'main';` — ingest is idempotent, re-processing is safe. |
| Suspected DB/chain drift | `npm run worker:once` with `RECONCILE_EVERY=1`, then review `audit_logs WHERE action IN ('chain_drift','funding_mismatch','reorg_rewind')`. |
| Funding mismatch (`funding_mismatch` audit) | Someone funded this ref with a different sender/amount/claim signer. The transfer stays `failed`; the sender should create a new transfer. |
| Payout stuck in `requested`/`processing` | Worker running? `PROVIDER_WEBHOOK_SECRET_SANDBOX` identical on web and worker? `provider_webhooks.processing_status` shows rejections. |
| Emails not sending | `notification_deliveries.last_error`; Resend domain verified; both env vars set. |
| Leaked claim link | The sender cancels the transfer (funds return); a claimed link cannot be undone. |

## Demo run (owner)

`SENDER_PRIVATE_KEY=… RECIPIENT_PRIVATE_KEY=… API_BASE_URL=https://<app> npm run demo:testnet` runs the full
two-wallet flow against the live API and testnet (≈ 55 MUSD + gas) and writes `docs/demo-run.json`.
