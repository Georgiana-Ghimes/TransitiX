-- Who invited whom.
--
-- The audit trail records the invitation, but the account itself carries no link back, so
-- "who let this person in" needs a search through the log rather than a column. Cheap to add
-- and the first thing anybody asks when an account looks unfamiliar.
--
-- ON DELETE SET NULL rather than CASCADE: an inviter leaving the company must never take the
-- accounts they created with them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users(company_id, invited_by);
