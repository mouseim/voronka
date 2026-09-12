CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL UNIQUE,
  username text,
  first_name text,
  last_name text,
  language_code text,
  timezone text,
  opted_out_at timestamptz,
  background_blocked boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_key text NOT NULL UNIQUE,
  source_funnel_id text NOT NULL UNIQUE,
  name text NOT NULL,
  default_for_bot boolean NOT NULL DEFAULT false,
  active_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funnel_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id uuid NOT NULL REFERENCES funnels(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  schema_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  content_hash text NOT NULL,
  raw_document jsonb NOT NULL,
  allow_placeholders boolean NOT NULL DEFAULT false,
  imported_by bigint,
  imported_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  archived_at timestamptz,
  UNIQUE (funnel_id, version),
  UNIQUE (funnel_id, content_hash)
);

ALTER TABLE funnels
  DROP CONSTRAINT IF EXISTS funnels_active_version_fk;
ALTER TABLE funnels
  ADD CONSTRAINT funnels_active_version_fk
  FOREIGN KEY (active_version_id) REFERENCES funnel_versions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_default_funnel
  ON funnels ((default_for_bot))
  WHERE default_for_bot = true;

CREATE TABLE IF NOT EXISTS media_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_file_id text NOT NULL,
  telegram_file_unique_id text,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'voice', 'video_note', 'document', 'animation')),
  mime_type text,
  file_size bigint,
  created_by bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS version_media_bindings (
  version_id uuid NOT NULL REFERENCES funnel_versions(id) ON DELETE RESTRICT,
  asset_id text NOT NULL,
  asset_key text NOT NULL,
  expected_type text NOT NULL,
  resource_id uuid REFERENCES media_resources(id) ON DELETE SET NULL,
  verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, asset_id)
);

CREATE TABLE IF NOT EXISTS runtime_product_configs (
  version_id uuid NOT NULL REFERENCES funnel_versions(id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  product_type text NOT NULL DEFAULT 'other' CHECK (product_type IN ('digital', 'service', 'physical', 'other')),
  provider text NOT NULL DEFAULT 'unconfigured' CHECK (provider IN ('unconfigured', 'mock', 'telegram_stars', 'yookassa')),
  currency text NOT NULL DEFAULT 'RUB',
  amount_minor integer NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  delivery_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_by_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  repeat_policy text NOT NULL DEFAULT 'redeliver' CHECK (repeat_policy IN ('deny', 'redeliver', 'repurchase')),
  after_purchase_text text NOT NULL DEFAULT '',
  configured_at timestamptz,
  PRIMARY KEY (version_id, product_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES telegram_users(id) ON DELETE RESTRICT,
  funnel_id uuid NOT NULL REFERENCES funnels(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES funnel_versions(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active', 'waiting', 'completed', 'abandoned', 'stopped', 'failed')),
  current_node_id text,
  source_tracking_id text,
  source_code text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  stopped_at timestamptz
);

CREATE INDEX IF NOT EXISTS sessions_user_funnel_idx ON sessions(user_id, funnel_id, status);
CREATE INDEX IF NOT EXISTS sessions_version_status_idx ON sessions(version_id, status);

CREATE TABLE IF NOT EXISTS test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  test_id text NOT NULL,
  question_order jsonb NOT NULL,
  answer_order jsonb NOT NULL,
  scores jsonb,
  maximums jsonb,
  percentages jsonb,
  primary_result_id text,
  secondary_result_id text,
  chosen_result_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  test_run_id uuid REFERENCES test_runs(id) ON DELETE RESTRICT,
  test_id text NOT NULL,
  question_id text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, test_id, question_id)
);

CREATE TABLE IF NOT EXISTS consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  node_id text NOT NULL,
  accepted boolean NOT NULL,
  policy_url text,
  consent_text text NOT NULL,
  funnel_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES telegram_users(id) ON DELETE RESTRICT,
  funnel_id uuid NOT NULL REFERENCES funnels(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES funnel_versions(id) ON DELETE RESTRICT,
  source_tracking_id text,
  result_id text,
  fields jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'new',
  payload jsonb NOT NULL,
  delivered_to_admin_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES telegram_users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  funnel_id uuid NOT NULL REFERENCES funnels(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES funnel_versions(id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  provider text NOT NULL,
  invoice_payload text NOT NULL UNIQUE,
  amount_minor integer NOT NULL,
  currency text NOT NULL,
  status text NOT NULL CHECK (status IN ('created', 'pending', 'paid', 'failed', 'refunded')),
  telegram_payment_charge_id text UNIQUE,
  provider_payment_charge_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  refunded_at timestamptz
);

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES telegram_users(id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES funnel_versions(id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  purchased_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, version_id, product_id)
);

CREATE TABLE IF NOT EXISTS content_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  asset_id text NOT NULL,
  delivery_key text NOT NULL UNIQUE,
  delivered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  user_id uuid REFERENCES telegram_users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES sessions(id) ON DELETE SET NULL,
  funnel_id uuid REFERENCES funnels(id) ON DELETE SET NULL,
  version_id uuid REFERENCES funnel_versions(id) ON DELETE SET NULL,
  node_id text,
  tracking_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_version_type_idx ON analytics_events(version_id, event_type, occurred_at);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id bigint PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS callback_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
  action jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS redirect_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES telegram_users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_url text NOT NULL,
  continue_after_click boolean NOT NULL,
  expires_at timestamptz NOT NULL,
  click_count integer NOT NULL DEFAULT 0,
  max_clicks integer NOT NULL DEFAULT 1,
  first_clicked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unique_key text NOT NULL UNIQUE,
  job_type text NOT NULL,
  payload jsonb NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'cancelled', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_due_idx ON jobs(status, due_at);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_telegram_id bigint NOT NULL,
  action text NOT NULL,
  funnel_id uuid REFERENCES funnels(id) ON DELETE SET NULL,
  version_id uuid REFERENCES funnel_versions(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
