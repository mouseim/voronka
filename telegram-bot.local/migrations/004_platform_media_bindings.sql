ALTER TABLE version_media_bindings
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'telegram',
  ADD COLUMN IF NOT EXISTS vk_attachment_type text,
  ADD COLUMN IF NOT EXISTS vk_owner_id bigint,
  ADD COLUMN IF NOT EXISTS vk_media_id bigint,
  ADD COLUMN IF NOT EXISTS vk_access_key text;

ALTER TABLE version_media_bindings
  DROP CONSTRAINT IF EXISTS version_media_bindings_pkey;
ALTER TABLE version_media_bindings
  ADD CONSTRAINT version_media_bindings_pkey PRIMARY KEY (version_id, asset_id, platform);

ALTER TABLE version_media_bindings
  DROP CONSTRAINT IF EXISTS version_media_bindings_platform_check;
ALTER TABLE version_media_bindings
  ADD CONSTRAINT version_media_bindings_platform_check
  CHECK (platform IN ('telegram', 'vk'));

ALTER TABLE version_media_bindings
  DROP CONSTRAINT IF EXISTS version_media_bindings_vk_type_check;
ALTER TABLE version_media_bindings
  ADD CONSTRAINT version_media_bindings_vk_type_check
  CHECK (vk_attachment_type IS NULL OR vk_attachment_type IN ('photo', 'video', 'doc', 'audio_message'));

ALTER TABLE version_media_bindings
  DROP CONSTRAINT IF EXISTS version_media_bindings_payload_check;
ALTER TABLE version_media_bindings
  ADD CONSTRAINT version_media_bindings_payload_check CHECK (
    (platform = 'telegram'
      AND vk_attachment_type IS NULL AND vk_owner_id IS NULL AND vk_media_id IS NULL AND vk_access_key IS NULL)
    OR
    (platform = 'vk'
      AND resource_id IS NULL AND vk_attachment_type IS NOT NULL AND vk_owner_id IS NOT NULL AND vk_media_id IS NOT NULL)
  );
