import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await createChallengeSessionsTable(sql);
  await addSessionToChallengesTable(sql);
}

async function createChallengeSessionsTable(sql: Sql) {
  await sql`
    CREATE TABLE challenge_sessions (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      uuid UUID NOT NULL,
      challenge_type SMALLINT NOT NULL,
      challenge_mode SMALLINT NOT NULL,
      party_hash VARCHAR(64) NOT NULL,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ,
      status SMALLINT NOT NULL DEFAULT 0
    );
  `;

  await sql`
    CREATE UNIQUE INDEX uix_challenge_sessions_uuid ON challenge_sessions (uuid);
  `;
  await sql`
    CREATE UNIQUE INDEX uix_session_new ON challenge_sessions (challenge_type, challenge_mode, party_hash) WHERE end_time IS NULL;
  `;
  await sql`
    CREATE INDEX idx_challenge_sessions_end_time ON challenge_sessions (end_time);
  `;
}

async function addSessionToChallengesTable(sql: Sql) {
  await sql`
    ALTER TABLE challenges
    ADD COLUMN session_id INT REFERENCES challenge_sessions(id) ON DELETE SET NULL,
    ADD COLUMN finish_time TIMESTAMPTZ;
  `;

  await sql`
    CREATE INDEX idx_challenges_session_id ON challenges (session_id);
  `;
}
