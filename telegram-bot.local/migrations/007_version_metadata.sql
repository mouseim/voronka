ALTER TABLE funnel_versions
  ADD COLUMN IF NOT EXISTS emoji text;

ALTER TABLE funnel_versions
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

CREATE INDEX IF NOT EXISTS funnel_versions_visible_idx
  ON funnel_versions(funnel_id, version DESC)
  WHERE hidden_at IS NULL;
