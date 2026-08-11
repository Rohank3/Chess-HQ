-- Email verification + password reset.
--
-- email was already captured at registration (optional, UNIQUE); these
-- columns add the verification state and the single outstanding token per
-- kind (verify / reset). Tokens are stored hashed (sha256) — never the raw
-- value — with their own expiry.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS verify_token_hash     text NULL,
  ADD COLUMN IF NOT EXISTS verify_token_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reset_token_hash      text NULL,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at timestamptz NULL;

-- Going forward, every registered (non-guest) account must carry an email —
-- it is the only channel for password recovery, and guests are the only rows
-- allowed to skip it. NOT VALID so the constraint applies to new writes while
-- leaving any pre-existing email-less rows (created while the field was
-- optional) untouched; the app layer already enforces it for sign-ups.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_required;
ALTER TABLE users ADD CONSTRAINT users_email_required
  CHECK (is_guest = TRUE OR email IS NOT NULL) NOT VALID;
