-- 002_games_termination_nullable.sql
-- Games are born "active": termination is only meaningful once the game
-- ends, and endGame writes it together with ended_at. The original schema
-- declared it NOT NULL with no default, but createGame's INSERT never
-- supplies it -- so EVERY game creation (matchmaking match or challenge
-- accept) crashed with a not-null constraint violation. Making it nullable
-- matches the intended lifecycle (NULL while active, set at game-over).
ALTER TABLE games ALTER COLUMN termination DROP NOT NULL;
