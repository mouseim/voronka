ALTER TABLE runtime_product_configs
  DROP CONSTRAINT IF EXISTS runtime_product_configs_provider_check;
ALTER TABLE runtime_product_configs
  ADD CONSTRAINT runtime_product_configs_provider_check
  CHECK (provider IN ('unconfigured', 'mock', 'telegram_stars', 'yookassa', 'yookassa_api'));

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS confirmation_url text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS fulfillment_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_payment_id_unique
  ON payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_pending_provider_idx
  ON payments(provider, status, created_at);

CREATE TABLE IF NOT EXISTS payment_integrations (
  provider text PRIMARY KEY CHECK (provider IN ('yookassa_api')),
  shop_id text NOT NULL,
  secret_ciphertext bytea NOT NULL,
  secret_iv bytea NOT NULL,
  secret_auth_tag bytea NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
