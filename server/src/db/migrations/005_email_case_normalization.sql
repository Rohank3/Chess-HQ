-- 005_email_case_normalization.sql
--
-- Emails are now normalized to lowercase and matched case-insensitively.
-- The users.email UNIQUE constraint (and every lookup) was case-sensitive,
-- so two accounts could hold the same address in different casing — e.g.
-- 'User@gmail.com' and 'user@gmail.com'. With case-sensitive matching, a
-- verification or reset token minted for one row left the other row
-- unverified, producing a "link verified my email, but login still asks me
-- to verify" loop (the token verifies row A; login reads row B).
--
-- This migration makes that state impossible going forward:
--   1. Case-variant duplicates are resolved — the row that is verified (or
--      the most recently created, when none is) keeps the email; the
--      loser's email moves to a synthetic unique placeholder. The
--      placeholder satisfies the email-format CHECK and the
--      registered-accounts-need-email CHECK, so that account keeps working
--      for play — it just has no recovery email.
--   2. All remaining emails are lowercased.
--   3. A unique index on LOWER(email) enforces case-insensitive uniqueness
--      at the database level.
--
-- The migration runner wraps the file in a transaction: a failure rolls
-- back and the boot aborts, so the schema is never left half-applied.

-- 1. Resolve case-variant duplicate emails. Every row whose lowercase email
--    is shared with another row participates. The winner (rn = 1) is the
--    verified row, else the most recently created; winners keep the
--    lowercased address, losers get a unique placeholder.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY LOWER(email)
           ORDER BY (email_verified_at IS NOT NULL) DESC, created_at DESC
         ) AS rn
  FROM users
  WHERE email IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM users o
      WHERE o.id <> users.id AND LOWER(o.email) = LOWER(users.email)
    )
)
UPDATE users u
SET email = CASE WHEN r.rn = 1 THEN LOWER(u.email)
                 ELSE 'discarded-' || u.id::text || '@invalid.local' END
FROM ranked r
WHERE r.id = u.id;

-- 2. Lowercase every remaining non-colliding email (after step 1 no
--    lowercase collisions can exist, so this can't violate UNIQUE).
UPDATE users
SET email = LOWER(email)
WHERE email IS NOT NULL AND email <> LOWER(email);

-- 3. Case-insensitive uniqueness going forward.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
  ON users (LOWER(email))
  WHERE email IS NOT NULL;
