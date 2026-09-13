ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'telegram',
  ADD COLUMN IF NOT EXISTS external_user_id text;

UPDATE telegram_users
SET external_user_id = telegram_id::text
WHERE external_user_id IS NULL;

ALTER TABLE telegram_users
  ALTER COLUMN external_user_id SET NOT NULL,
  ALTER COLUMN telegram_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS telegram_users_platform_check,
  ADD CONSTRAINT telegram_users_platform_check CHECK (platform IN ('telegram', 'vk'));

CREATE UNIQUE INDEX IF NOT EXISTS telegram_users_platform_external_id_idx
  ON telegram_users(platform, external_user_id);

ALTER TABLE processed_updates
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'telegram',
  ADD COLUMN IF NOT EXISTS external_update_id text;

UPDATE processed_updates
SET external_update_id = update_id::text
WHERE external_update_id IS NULL;

ALTER TABLE processed_updates
  DROP CONSTRAINT IF EXISTS processed_updates_pkey;

ALTER TABLE processed_updates
  ALTER COLUMN external_update_id SET NOT NULL,
  ALTER COLUMN update_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS processed_updates_platform_check,
  ADD CONSTRAINT processed_updates_platform_check CHECK (platform IN ('telegram', 'vk')),
  ADD PRIMARY KEY (platform, external_update_id);
