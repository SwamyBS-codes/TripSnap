-- Application-level admin role.
-- The API also applies these statements idempotently at startup for existing
-- installations that were created from an older schema.sql.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Preserve existing workflows during the first upgrade: current trip owners
-- become app admins. This bootstrap only runs while there is at most one
-- admin, so it cannot keep promoting people later.
UPDATE users
SET is_admin = true
WHERE id IN (SELECT DISTINCT owner_id FROM trips)
  AND (SELECT count(*) FROM users WHERE is_admin) <= 1;

-- A brand-new installation with accounts but no trips still needs an admin.
UPDATE users
SET is_admin = true
WHERE id = (
  SELECT u.id
  FROM users u
  LEFT JOIN trips t ON t.owner_id = u.id
  GROUP BY u.id
  ORDER BY (count(t.id) > 0) DESC, u.created_at ASC
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin);
