ALTER TABLE funnels
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS funnels_visible_updated_idx
  ON funnels(updated_at DESC)
  WHERE archived_at IS NULL;
