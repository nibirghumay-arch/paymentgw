-- ============================================================
-- BD Payment Gateway — SQLite schema
-- bKash / Nagad / Rocket "Send Money" style auto-verified gateway
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- ADMIN — gateway operator, logs into /admin
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- RECEIVING ACCOUNTS — owner's real bKash/Nagad/Rocket numbers.
-- device_key is the secret the Android SMS-forwarder app uses
-- to authenticate its webhook POSTs for this specific number.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receiving_accounts (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL CHECK (provider IN ('BKASH','NAGAD','ROCKET','UPAY')),
  msisdn      TEXT NOT NULL,
  label       TEXT,
  device_key  TEXT UNIQUE NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recv_provider_active ON receiving_accounts(provider, is_active);

-- ------------------------------------------------------------
-- MERCHANTS — websites/apps using the gateway
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  api_key         TEXT UNIQUE NOT NULL,
  api_secret_hash TEXT NOT NULL,
  webhook_url     TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- INCOMING SMS — raw + parsed messages forwarded from the
-- owner's phone. Source of truth for "money actually arrived".
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incoming_sms (
  id                   TEXT PRIMARY KEY,
  receiving_account_id TEXT NOT NULL REFERENCES receiving_accounts(id),
  raw_text             TEXT NOT NULL,
  sent_at              TEXT,
  received_at          TEXT NOT NULL DEFAULT (datetime('now')),
  provider             TEXT NOT NULL CHECK (provider IN ('BKASH','NAGAD','ROCKET','UPAY')),
  parse_status         TEXT NOT NULL DEFAULT 'UNPARSED' CHECK (parse_status IN ('PARSED','UNPARSED','IGNORED')),
  parsed_trx_id        TEXT,
  parsed_amount_bdt    REAL,
  parsed_sender_msisdn TEXT,
  is_used              INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sms_trxid ON incoming_sms(parsed_trx_id);
CREATE INDEX IF NOT EXISTS idx_sms_account_used ON incoming_sms(receiving_account_id, is_used);
CREATE INDEX IF NOT EXISTS idx_sms_parse_status ON incoming_sms(parse_status);

-- ------------------------------------------------------------
-- ORDERS — a single payment request from a merchant site
-- Lifecycle: PENDING -> SUBMITTED -> MATCHED -> APPROVED
--                    -> or REJECTED / EXPIRED
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                    TEXT PRIMARY KEY,
  reference             TEXT UNIQUE NOT NULL,
  merchant_id           TEXT NOT NULL REFERENCES merchants(id),
  amount_bdt            REAL NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'BDT',
  provider              TEXT NOT NULL CHECK (provider IN ('BKASH','NAGAD','ROCKET','UPAY')),
  receiving_account_id  TEXT NOT NULL REFERENCES receiving_accounts(id),
  status                TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUBMITTED','MATCHED','APPROVED','REJECTED','EXPIRED')),
  customer_msisdn       TEXT,
  submitted_trx_id      TEXT,
  matched_sms_id        TEXT UNIQUE REFERENCES incoming_sms(id),
  metadata              TEXT,
  return_url            TEXT,
  expires_at            TEXT NOT NULL,
  approved_at           TEXT,
  webhook_sent_at       TEXT,
  webhook_attempts      INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_status ON orders(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_trxid ON orders(submitted_trx_id);

-- ------------------------------------------------------------
-- AUDIT LOG — every state-changing action, for dispute handling
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  target_id  TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_id);
