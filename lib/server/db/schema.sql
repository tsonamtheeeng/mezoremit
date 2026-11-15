-- FROZEN. MezoRemit schema (Postgres 15+ / PGlite). Idempotent: safe to run on every boot.
-- Columns marked [chain] are written ONLY by the indexer / receipt verifier from confirmed logs of the
-- RemittanceManager, never from client input. Amounts are NUMERIC(78,0) MUSD base units; times TIMESTAMPTZ.
-- Privacy: names, contact references, notes live here only; never on-chain, never in public endpoints.

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL UNIQUE,              -- lowercase 0x…
  display_name    TEXT,
  email           TEXT,
  notify_email    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce       TEXT PRIMARY KEY,
  address     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipients (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name               TEXT NOT NULL,
  country                    TEXT NOT NULL,           -- ISO alpha-2
  wallet_address             TEXT,                    -- lowercase, optional
  preferred_delivery_method  TEXT NOT NULL,           -- mezo_wallet|claim_link|local_payout_sandbox
  contact_ciphertext         TEXT,                    -- AES-256-GCM (v1:<iv>:<tag>:<ct> base64), key = RECIPIENT_DATA_KEY
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                 TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS recipients_user_idx ON recipients (user_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS transfer_quotes (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID REFERENCES users(id),
  kind                   TEXT NOT NULL,               -- indicative|executable
  source_currency        TEXT NOT NULL DEFAULT 'MUSD',
  source_amount          NUMERIC(78,0) NOT NULL,
  destination_country    TEXT NOT NULL,
  destination_currency   TEXT NOT NULL,
  delivery_method        TEXT NOT NULL,
  reference_rate         NUMERIC(38,18) NOT NULL,
  provider_rate          NUMERIC(38,18),
  fx_markup_bps          INTEGER NOT NULL DEFAULT 0,
  service_fee            NUMERIC(78,0) NOT NULL DEFAULT 0,
  recipient_amount_musd  NUMERIC(78,0) NOT NULL,
  recipient_amount_local NUMERIC(38,6),
  provider               TEXT NOT NULL,
  rate_source            TEXT NOT NULL,
  rate_timestamp         TIMESTAMPTZ NOT NULL,
  expires_at             TIMESTAMPTZ NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transfers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- claim link path segment
  ref                 TEXT NOT NULL UNIQUE,            -- bytes32 hex = transferRef(id)
  idempotency_key     TEXT NOT NULL,
  sender_user_id      UUID NOT NULL REFERENCES users(id),
  sender_address      TEXT NOT NULL,                   -- session address at creation; [chain] verified on funding
  recipient_id        UUID REFERENCES recipients(id),
  method              TEXT NOT NULL,                   -- direct|claim
  recipient_wallet    TEXT,                            -- direct: intended; [chain] claim: set from TransferClaimed
  claim_signer        TEXT,                            -- claim: claim-key address (public; key itself never stored)
  destination_country TEXT NOT NULL,
  amount              NUMERIC(78,0) NOT NULL,
  fee                 NUMERIC(78,0) NOT NULL DEFAULT 0,
  quote_id            UUID REFERENCES transfer_quotes(id),
  note                TEXT,
  show_sender_name    BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at          TIMESTAMPTZ,                     -- claim: requested; [chain] overwritten from event
  status              TEXT NOT NULL DEFAULT 'awaiting_funding',
  chain_transfer_id   NUMERIC(78,0) UNIQUE,            -- [chain]
  chain_status        TEXT,                            -- [chain] funded|claimed|cancelled|refunded|completed
  funding_tx_hash     TEXT,                            -- client hint until [chain] confirms
  funding_submitted_at TIMESTAMPTZ,
  settlement_tx_hash  TEXT,                            -- [chain] claim/cancel/refund
  claim_submitted_tx  TEXT,                            -- hint (relayer or recipient)
  funded_at           TIMESTAMPTZ,                     -- [chain] block time
  settled_at          TIMESTAMPTZ,                     -- [chain] block time
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS transfers_idem_uq ON transfers (sender_user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS transfers_sender_idx ON transfers (sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS transfers_recipient_wallet_idx ON transfers (recipient_wallet);
CREATE INDEX IF NOT EXISTS transfers_status_idx ON transfers (status);

-- App-recorded and chain-verified timeline. Unique (transfer_id, kind) for one-shot milestones.
CREATE TABLE IF NOT EXISTS transfer_timeline (
  id           BIGSERIAL PRIMARY KEY,
  transfer_id  UUID NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  source       TEXT NOT NULL,                          -- chain|app|sandbox
  tx_hash      TEXT,
  detail       TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, kind)
);

CREATE TABLE IF NOT EXISTS claims (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id             UUID NOT NULL UNIQUE REFERENCES transfers(id),
  recipient_wallet        TEXT NOT NULL,               -- [chain]
  claim_transaction_hash  TEXT NOT NULL,               -- [chain]
  submitter               TEXT NOT NULL,               -- [chain] relayer or recipient
  relayed                 BOOLEAN NOT NULL DEFAULT FALSE,
  block_number            NUMERIC(78,0) NOT NULL,
  claimed_at              TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS claims_recipient_idx ON claims (recipient_wallet);

-- Gas-relay bookkeeping (one active relay per transfer; rate limiting).
CREATE TABLE IF NOT EXISTS relay_attempts (
  id           BIGSERIAL PRIMARY KEY,
  transfer_id  UUID NOT NULL REFERENCES transfers(id),
  recipient    TEXT NOT NULL,
  tx_hash      TEXT,
  status       TEXT NOT NULL,                          -- submitted|confirmed|reverted|rejected
  error        TEXT,
  ip_hash      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS relay_attempts_transfer_idx ON relay_attempts (transfer_id);

CREATE TABLE IF NOT EXISTS payout_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id           UUID NOT NULL REFERENCES transfers(id),
  user_id               UUID NOT NULL REFERENCES users(id),     -- the recipient requesting payout
  provider              TEXT NOT NULL,
  simulated             BOOLEAN NOT NULL,
  destination_currency  TEXT NOT NULL,
  payout_amount         NUMERIC(38,6) NOT NULL,
  quote_id              UUID REFERENCES transfer_quotes(id),
  provider_reference    TEXT,
  status                TEXT NOT NULL DEFAULT 'requested',      -- requested|processing|completed|failed|cancelled
  status_detail         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payout_active_uq ON payout_requests (transfer_id) WHERE status <> 'failed' AND status <> 'cancelled';

CREATE TABLE IF NOT EXISTS blockchain_events (
  id                 BIGSERIAL PRIMARY KEY,
  chain_id           INTEGER NOT NULL,
  transaction_hash   TEXT NOT NULL,
  log_index          INTEGER NOT NULL,
  block_number       NUMERIC(78,0) NOT NULL,
  block_hash         TEXT NOT NULL,
  event_name         TEXT NOT NULL,
  chain_transfer_id  NUMERIC(78,0) NOT NULL,
  args               JSONB NOT NULL,
  removed            BOOLEAN NOT NULL DEFAULT FALSE,   -- set on reorg
  processed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS blockchain_events_transfer_idx ON blockchain_events (chain_transfer_id);
CREATE INDEX IF NOT EXISTS blockchain_events_block_idx ON blockchain_events (block_number);

CREATE TABLE IF NOT EXISTS indexer_cursor (
  name             TEXT PRIMARY KEY,
  last_block       NUMERIC(78,0) NOT NULL,
  last_block_hash  TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recent block hashes for reorg detection (pruned to the last ~200).
CREATE TABLE IF NOT EXISTS indexer_blocks (
  block_number  NUMERIC(78,0) PRIMARY KEY,
  block_hash    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_webhooks (
  id                 BIGSERIAL PRIMARY KEY,
  provider           TEXT NOT NULL,
  event_id           TEXT NOT NULL,
  payload            JSONB NOT NULL,
  signature_valid    BOOLEAN NOT NULL,
  processing_status  TEXT NOT NULL DEFAULT 'received',   -- received|processed|rejected|failed
  error              TEXT,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ,
  UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transfer_id  UUID REFERENCES transfers(id),
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL UNIQUE,                   -- e.g. "<transfer>:<type>:<user>"
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                   BIGSERIAL PRIMARY KEY,
  notification_id      UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel              TEXT NOT NULL,                  -- email
  status               TEXT NOT NULL DEFAULT 'queued', -- queued|sent|failed
  provider_message_id  TEXT,
  attempts             INTEGER NOT NULL DEFAULT 0,
  last_error           TEXT,
  next_attempt_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (notification_id, channel)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  actor        TEXT NOT NULL,                          -- user:<uuid> | worker | relayer | provider:<id>
  action       TEXT NOT NULL,
  resource_id  TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',           -- never PII / secrets
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker_heartbeat (
  name        TEXT PRIMARY KEY,
  detail      JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start TIMESTAMPTZ NOT NULL
);
