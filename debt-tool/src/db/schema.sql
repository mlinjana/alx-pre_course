-- Mlinjana Financial Group — client debt tool schema.
--
-- Money is stored in CENTS as INTEGER throughout. Never store rands as REAL:
-- floating point drift on a debt balance is a compliance problem, not a rounding quirk.
--
-- Personally identifying fields that are not needed for search (ID numbers, full
-- account numbers) are stored encrypted via src/db/crypto.js. Searchable
-- equivalents are stored as a keyed hash (id_number_hash) or a masked string.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Staff users ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  full_name      TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('admin', 'consultant', 'readonly')),
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  is_active      INTEGER NOT NULL DEFAULT 1,
  must_reset     INTEGER NOT NULL DEFAULT 0,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sessions live in the database rather than memory so that restarts do not log
-- every consultant out mid-consultation, and so an admin can revoke a session.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ── Clients ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id                INTEGER PRIMARY KEY,
  reference         TEXT NOT NULL UNIQUE,       -- human-facing file number, e.g. MFG-2026-0042
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  id_number_enc     TEXT NOT NULL,              -- SA ID number, encrypted at rest
  id_number_hash    TEXT NOT NULL UNIQUE,       -- keyed hash, lets us search without decrypting
  id_number_last4   TEXT NOT NULL,              -- for staff to confirm they have the right file
  date_of_birth     TEXT,
  email             TEXT,
  phone             TEXT,
  employment_status TEXT,
  marital_status    TEXT,
  dependants        INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'under_review', 'closed')),
  notes             TEXT,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- ── POPIA / NCA consent ──────────────────────────────────────────────────────
-- No bureau enquiry may run without a live consent row. Enforced in
-- src/services/consent.js, not just by convention.
CREATE TABLE IF NOT EXISTS consents (
  id            INTEGER PRIMARY KEY,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  consent_type  TEXT NOT NULL CHECK (consent_type IN ('bureau_enquiry', 'data_processing', 'marketing')),
  granted_at    TEXT NOT NULL,
  expires_at    TEXT,
  revoked_at    TEXT,
  method        TEXT NOT NULL CHECK (method IN ('written', 'electronic', 'voice_recorded', 'in_person')),
  evidence_ref  TEXT,                            -- where the signed mandate / recording is filed
  captured_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_consents_client ON consents(client_id, consent_type);

-- ── Bureau snapshots ─────────────────────────────────────────────────────────
-- Every pull is kept as an immutable snapshot, so "what did this client owe on
-- 12 March" is answerable, and so a disputed balance can be traced to its source.
CREATE TABLE IF NOT EXISTS bureau_snapshots (
  id                INTEGER PRIMARY KEY,
  client_id         INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,               -- transunion | experian | xds | mock | pdf_import | manual
  source_kind       TEXT NOT NULL CHECK (source_kind IN ('api', 'pdf_import', 'manual')),
  is_simulated      INTEGER NOT NULL DEFAULT 0,  -- 1 when produced by the mock provider
  status            TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'draft')),
  reference         TEXT,                        -- bureau-side enquiry reference
  credit_score      INTEGER,
  score_band        TEXT,
  raw_payload       TEXT,                        -- JSON as returned, for dispute resolution
  error_message     TEXT,
  requested_by      INTEGER REFERENCES users(id),
  requested_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshots_client ON bureau_snapshots(client_id, requested_at DESC);

-- ── Credit accounts (the actual debt) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_accounts (
  id                    INTEGER PRIMARY KEY,
  client_id             INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  snapshot_id           INTEGER REFERENCES bureau_snapshots(id) ON DELETE CASCADE,
  creditor_name         TEXT NOT NULL,
  creditor_normalised   TEXT NOT NULL,           -- lowercased/trimmed, for grouping the same creditor
  account_number_enc    TEXT,
  account_number_masked TEXT,
  account_type          TEXT NOT NULL,           -- see ACCOUNT_TYPES in src/bureaus/normalise.js
  opened_date           TEXT,
  current_balance_cents     INTEGER NOT NULL DEFAULT 0,
  original_amount_cents     INTEGER,
  monthly_instalment_cents  INTEGER NOT NULL DEFAULT 0,
  arrears_amount_cents      INTEGER NOT NULL DEFAULT 0,
  credit_limit_cents        INTEGER,
  months_in_arrears     INTEGER NOT NULL DEFAULT 0,
  interest_rate_annual  REAL,                    -- e.g. 0.235 for 23.5%
  status                TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'closed', 'written_off', 'legal', 'under_debt_review', 'unknown')),
  last_payment_date     TEXT,
  bureau_updated_at     TEXT,                    -- when the bureau last heard from the creditor
  is_excluded           INTEGER NOT NULL DEFAULT 0,  -- staff can exclude an account from the restructure
  exclusion_reason      TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_client ON credit_accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_accounts_snapshot ON credit_accounts(snapshot_id);

-- ── Affordability ────────────────────────────────────────────────────────────
-- Kept as dated rows rather than mutable columns: an assessment is a point-in-time
-- statement and old ones must remain readable.
CREATE TABLE IF NOT EXISTS financial_profiles (
  id                         INTEGER PRIMARY KEY,
  client_id                  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  gross_monthly_income_cents INTEGER NOT NULL DEFAULT 0,
  net_monthly_income_cents   INTEGER NOT NULL DEFAULT 0,
  other_income_cents         INTEGER NOT NULL DEFAULT 0,
  expenses_json              TEXT NOT NULL DEFAULT '{}',  -- {housing: cents, transport: cents, ...}
  effective_from             TEXT NOT NULL DEFAULT (datetime('now')),
  captured_by                INTEGER REFERENCES users(id),
  created_at                 TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profiles_client ON financial_profiles(client_id, effective_from DESC);

-- ── Audit log ────────────────────────────────────────────────────────────────
-- POPIA expects us to know who looked at what. Append-only by discipline;
-- nothing in the application issues UPDATE or DELETE against this table.
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY,
  actor_id     INTEGER REFERENCES users(id),
  actor_email  TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  detail_json  TEXT,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
