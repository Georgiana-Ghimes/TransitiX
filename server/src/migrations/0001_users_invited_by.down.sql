DROP INDEX IF EXISTS idx_users_invited_by;
ALTER TABLE users DROP COLUMN IF EXISTS invited_at;
ALTER TABLE users DROP COLUMN IF EXISTS invited_by;
