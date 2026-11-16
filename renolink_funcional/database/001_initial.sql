-- Aplicar apenas pelo migrador, em transação e em banco de destino dedicado.
CREATE TABLE IF NOT EXISTS renolink_users (
  id bigint PRIMARY KEY CHECK (id > 0), name text NOT NULL,
  email text NOT NULL, role text NOT NULL CHECK (role IN ('creator','company')),
  company text NOT NULL, salt text NOT NULL, password_hash text NOT NULL,
  created_at timestamptz NOT NULL, extra jsonb NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS renolink_users_email_uq ON renolink_users (lower(btrim(email)));
CREATE TABLE IF NOT EXISTS renolink_ideas (
  id bigint PRIMARY KEY CHECK (id > 0), user_id bigint REFERENCES renolink_users(id) ON DELETE RESTRICT,
  title text NOT NULL, category text NOT NULL, problem text NOT NULL, solution text NOT NULL,
  beneficiaries text NOT NULL, participation text NOT NULL, status text NOT NULL, potential text NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, extra jsonb NOT NULL DEFAULT '{}',
  UNIQUE (id, user_id)
);
CREATE INDEX IF NOT EXISTS renolink_ideas_owner_idx ON renolink_ideas(user_id);
CREATE INDEX IF NOT EXISTS renolink_ideas_status_updated_idx ON renolink_ideas(status, updated_at DESC);
CREATE TABLE IF NOT EXISTS renolink_negotiations (
  id bigint PRIMARY KEY CHECK (id > 0), idea_id bigint NOT NULL REFERENCES renolink_ideas(id) ON DELETE RESTRICT,
  creator_user_id bigint NOT NULL REFERENCES renolink_users(id) ON DELETE RESTRICT,
  company_user_id bigint NOT NULL REFERENCES renolink_users(id) ON DELETE RESTRICT,
  status text NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}', UNIQUE(idea_id, company_user_id),
  FOREIGN KEY (idea_id, creator_user_id) REFERENCES renolink_ideas(id, user_id) ON DELETE RESTRICT,
  CHECK (creator_user_id <> company_user_id)
);
CREATE INDEX IF NOT EXISTS renolink_negotiations_creator_idx ON renolink_negotiations(creator_user_id);
CREATE INDEX IF NOT EXISTS renolink_negotiations_company_idx ON renolink_negotiations(company_user_id);
CREATE TABLE IF NOT EXISTS renolink_messages (
  id bigint PRIMARY KEY CHECK (id > 0), from_user_id bigint NOT NULL REFERENCES renolink_users(id) ON DELETE RESTRICT,
  to_user_id bigint NOT NULL REFERENCES renolink_users(id) ON DELETE RESTRICT,
  text text NOT NULL CHECK (length(btrim(text)) > 0), created_at timestamptz NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS renolink_messages_from_date_idx ON renolink_messages(from_user_id, created_at);
CREATE INDEX IF NOT EXISTS renolink_messages_to_date_idx ON renolink_messages(to_user_id, created_at);
CREATE TABLE IF NOT EXISTS renolink_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id bigint NOT NULL REFERENCES renolink_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  revoked_at timestamptz, extra jsonb NOT NULL DEFAULT '{}', CHECK (expires_at >= created_at)
);
CREATE INDEX IF NOT EXISTS renolink_sessions_user_idx ON renolink_sessions(user_id);
CREATE INDEX IF NOT EXISTS renolink_sessions_expiry_idx ON renolink_sessions(expires_at) WHERE revoked_at IS NULL;
-- Os contadores preservados são alocados sob advisory lock transacional.
CREATE TABLE IF NOT EXISTS renolink_meta (
  id integer PRIMARY KEY CHECK (id = 1), payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS renolink_imports (
  source_sha256 text PRIMARY KEY, counts jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now()
);
