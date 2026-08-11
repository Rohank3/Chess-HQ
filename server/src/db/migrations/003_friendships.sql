-- 003_friendships.sql — friend relationships for direct challenges.
--
-- One row per user pair, in either direction: when A requests B we store
-- (A, B, 'pending'); if the reverse row (B, A) already exists the request is
-- auto-accepted by flipping its status instead of inserting a duplicate, so a
-- pair never has more than one row. `status` moves pending -> accepted.
--
-- Guests are not friendable: the friends API rejects requests where either
-- side is a guest (users.is_guest), and only registered users see the friend
-- UI. The FK still points at users for integrity.
CREATE TABLE IF NOT EXISTS friendships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz NULL,

  CONSTRAINT friendships_distinct CHECK (requester_id <> addressee_id)
);

-- One row per unordered pair: the LEAST/GREATEST expression index makes the
-- uniqueness symmetric no matter who requested whom (expression indexes are
-- the only way to UNIQUE a function of columns).
CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique
  ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

-- Lookups by each side (list friends / incoming / outgoing requests).
CREATE INDEX IF NOT EXISTS friendships_requester_idx
  ON friendships(requester_id, status);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx
  ON friendships(addressee_id, status);
