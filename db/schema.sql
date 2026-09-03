-- ============================================================
-- BD Payment Gateway — PostgreSQL schema
-- bKash / Nagad / Rocket / Upay "Send Money" auto-verified gateway
--
-- Applied by:  npm run db:migrate   (scripts/migrate.ts)
-- Idempotent: safe to re-run on an existing database.
--
-- Ported from the original SQLite schema. Type mapping:
--   TEXT ... DEFAULT (datetime('now'))  ->  TIMESTAMPTZ DEFAULT now()
--   INTEGER (0/1)                       ->  BOOLEAN
--   REAL (money)                        ->  NUMERIC(14,2)
--   CHECK (x IN (...))                  ->  native ENUM types
-- ============================================================

-- ------------------------------------------------------------
-- ENUMS — created only if absent so migrate is re-runnable.
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE provider_kind AS ENUM ('BKASH', 'NAGAD', 'ROCKET', 'UPAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sms_parse_status AS ENUM ('PARSED', 'UNPARSED', 'IGNORED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'PENDING', 'SUBMITTED', 'MATCHED', 'APPROVED', 'REJECTED', 'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE webhook_state AS ENUM ('NONE', 'PENDING', 'DELIVERED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- ADMIN — gateway operator, logs into /admin
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- RECEIVING ACCOUNTS — owner's real bKash/Nagad/Rocket numbers.
-- device_key is the secret the Android SMS-forwarder app uses
-- to authenticate its webhook POSTs for this specific number.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receiving_accounts (
  id          TEXT PRIMARY KEY,
  provider    provider_kind NOT NULL,
  msisdn      TEXT NOT NULL,
  label       TEXT,
  device_key  TEXT UNIQUE NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recv_provider_active
  ON receiving_accounts (provider, is_active);

-- ------------------------------------------------------------
-- MERCHANTS — websites/apps using the gateway (e.g. the betting
-- platform). webhook_secret signs the HMAC on outbound webhooks
-- so the merchant can prove a callback really came from us.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  api_key         TEXT UNIQUE NOT NULL,
  api_secret_hash TEXT NOT NULL,
  webhook_url     TEXT,
  webhook_secret  TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- INCOMING SMS — raw + parsed messages forwarded from the
-- owner's phone. Source of truth for "money actually arrived".
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incoming_sms (
  id                   TEXT PRIMARY KEY,
  receiving_account_id TEXT NOT NULL REFERENCES receiving_accounts (id),
  raw_text             TEXT NOT NULL,
  sent_at              TIMESTAMPTZ,
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider             provider_kind NOT NULL,
  parse_status         sms_parse_status NOT NULL DEFAULT 'UNPARSED',
  parsed_trx_id        TEXT,
  parsed_amount_bdt    NUMERIC(14, 2),
  parsed_sender_msisdn TEXT,
  is_used              BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_sms_trxid ON incoming_sms (parsed_trx_id);
CREATE INDEX IF NOT EXISTS idx_sms_account_used
  ON incoming_sms (receiving_account_id, is_used);
CREATE INDEX IF NOT EXISTS idx_sms_parse_status ON incoming_sms (parse_status);

-- A given provider never reuses a TrxID, so this both prevents the
-- forwarder app from double-posting the same SMS and gives the matcher
-- a hard uniqueness guarantee to lean on.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_provider_trxid
  ON incoming_sms (provider, parsed_trx_id)
  WHERE parsed_trx_id IS NOT NULL;

-- ------------------------------------------------------------
-- ORDERS — a single payment request from a merchant site
-- Lifecycle: PENDING -> SUBMITTED -> APPROVED
--                    -> or REJECTED / EXPIRED
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                   TEXT PRIMARY KEY,
  reference            TEXT UNIQUE NOT NULL,
  merchant_id          TEXT NOT NULL REFERENCES merchants (id),
  amount_bdt           NUMERIC(14, 2) NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'BDT',
  provider             provider_kind NOT NULL,
  receiving_account_id TEXT NOT NULL REFERENCES receiving_accounts (id),
  status               order_status NOT NULL DEFAULT 'PENDING',
  customer_msisdn      TEXT,
  submitted_trx_id     TEXT,
  matched_sms_id       TEXT UNIQUE REFERENCES incoming_sms (id),
  metadata             JSONB,
  return_url           TEXT,
  expires_at           TIMESTAMPTZ NOT NULL,
  approved_at          TIMESTAMPTZ,
  webhook_status       webhook_state NOT NULL DEFAULT 'NONE',
  webhook_sent_at      TIMESTAMPTZ,
  webhook_attempts     INTEGER NOT NULL DEFAULT 0,
  webhook_last_error   TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_status ON orders (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_trxid ON orders (submitted_trx_id);
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_orders_webhook_retry
  ON orders (webhook_status, webhook_attempts);

-- ------------------------------------------------------------
-- AUDIT LOG — every state-changing action, for dispute handling
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target_id  TEXT,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log (target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
