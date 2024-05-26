import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await createUsersTable(sql);
  await createPlayersTable(sql);
  await createApiKeysTable(sql);
  await createNameChangesTable(sql);
  await createChallengesTables(sql);
  await createRecordedChallengesTable(sql);
  await createPersonalBestsTable(sql);
  await createPlayerStatsTable(sql);
  await createQueryableEventsTable(sql);
}

async function createUsersTable(sql: Sql) {
  await sql`
    CREATE TABLE users (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      username VARCHAR(30) NOT NULL,
      password VARCHAR(100) NOT NULL,
      email VARCHAR(128) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      can_create_api_key BOOLEAN NOT NULL DEFAULT FALSE
    );
  `;

  await sql`
    CREATE UNIQUE INDEX uix_users_username ON users (lower(username));
  `;
  await sql`
    CREATE UNIQUE INDEX uix_users_email ON users (email);
  `;
}

async function createPlayersTable(sql: Sql) {
  await sql`
    CREATE TABLE players (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      username VARCHAR(12) NOT NULL,
      total_recordings INT DEFAULT 0,
      overall_experience BIGINT DEFAULT 0,
      attack_experience INT DEFAULT 0,
      strength_experience INT DEFAULT 0,
      defence_experience INT DEFAULT 0,
      ranged_experience INT DEFAULT 0,
      magic_experience INT DEFAULT 0,
      prayer_experience INT DEFAULT 0,
      hitpoints_experience INT DEFAULT 0,
      last_updated TIMESTAMPTZ
    );
  `;

  await sql`
    CREATE UNIQUE INDEX uix_players_username ON players (lower(username));
  `;
}

async function createApiKeysTable(sql: Sql) {
  await sql`
    CREATE TABLE api_keys (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      player_id INT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
      key VARCHAR(32) NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      last_used TIMESTAMPTZ
    );
  `;

  await sql`
    CREATE UNIQUE INDEX uix_api_keys_key ON api_keys (key);
  `;
  await sql`
    CREATE INDEX idx_api_keys_user_id ON api_keys (user_id);
  `;
}

async function createNameChangesTable(sql: Sql) {
  await sql`
    CREATE TABLE name_changes (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      player_id INT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
      submitter_id INT REFERENCES users (id) ON DELETE CASCADE,
      old_name VARCHAR(12) NOT NULL,
      new_name VARCHAR(12) NOT NULL,
      status SMALLINT NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL,
      processed_at TIMESTAMPTZ,
      migrated_documents INT DEFAULT 0
    );
  `;

  await sql`
    CREATE INDEX idx_name_changes_player_id ON name_changes (player_id);
  `;
  await sql`
    CREATE INDEX idx_name_changes_submitted_at ON name_changes (submitted_at);
  `;
}

async function createChallengesTables(sql: Sql) {
  await sql`
    CREATE TABLE challenges (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      uuid UUID NOT NULL,
      type SMALLINT NOT NULL,
      status SMALLINT DEFAULT 0,
      stage SMALLINT DEFAULT 0,
      mode SMALLINT DEFAULT 0,
      scale SMALLINT NOT NULL,
      start_time TIMESTAMPTZ,
      challenge_ticks INT DEFAULT 0,
      overall_ticks INT,
      total_deaths INT DEFAULT 0
    );
  `;

  await sql`
    CREATE TABLE challenge_players (
      challenge_id INT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      player_id INT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
      username VARCHAR(12) NOT NULL,
      orb SMALLINT NOT NULL,
      primary_gear SMALLINT NOT NULL
    );
  `;

  await sql`
    CREATE TABLE challenge_splits (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      challenge_id INT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      type SMALLINT NOT NULL,
      scale SMALLINT NOT NULL,
      ticks INT NOT NULL,
      accurate BOOLEAN NOT NULL
    );
  `;

  await sql`
    CREATE UNIQUE INDEX uix_challenges_uuid ON challenges (uuid);
  `;
  await sql`
    CREATE INDEX idx_challenges_type ON challenges (type);
  `;
  await sql`
    CREATE INDEX idx_challenges_status ON challenges (status);
  `;

  await sql`
    CREATE INDEX idx_challenge_players_challenge_id ON challenge_players (challenge_id);
  `;
  await sql`
    CREATE INDEX idx_challenge_players_player_id ON challenge_players (player_id);
  `;

  await sql`
    CREATE INDEX idx_challenge_splits_challenge_id ON challenge_splits (challenge_id);
  `;
  await sql`
    CREATE INDEX idx_challenge_splits_type_scale_ticks ON challenge_splits (type, scale, ticks) WHERE accurate;
  `;
}

async function createPersonalBestsTable(sql: Sql) {
  await sql`
    CREATE TABLE personal_bests (
      player_id INT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
      challenge_split_id INT NOT NULL REFERENCES challenge_splits (id) ON DELETE CASCADE,
      PRIMARY KEY (player_id, challenge_split_id)
    );
  `;

  await sql`
    CREATE INDEX idx_personal_bests_player_id ON personal_bests (player_id);
  `;
}

async function createRecordedChallengesTable(sql: Sql) {
  await sql`
    CREATE TABLE recorded_challenges (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      challenge_id INT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      recorder_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      recording_type SMALLINT NOT NULL
    );
  `;

  await sql`
    CREATE INDEX idx_recorded_challenges_recorder_id ON recorded_challenges (recorder_id);
  `;
}

async function createPlayerStatsTable(sql: Sql) {
  await sql`
    CREATE TABLE player_stats (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      player_id INT NOT NULL REFERENCES players (id) ON DELETE CASCADE,
      date TIMESTAMPTZ NOT NULL,

      tob_completions INT DEFAULT 0,
      tob_wipes INT DEFAULT 0,
      tob_resets INT DEFAULT 0,

      colosseum_completions INT DEFAULT 0,
      colosseum_wipes INT DEFAULT 0,
      colosseum_resets INT DEFAULT 0,

      deaths_total INT DEFAULT 0,
      deaths_maiden INT DEFAULT 0,
      deaths_bloat INT DEFAULT 0,
      deaths_nylocas INT DEFAULT 0,
      deaths_sotetseg INT DEFAULT 0,
      deaths_xarpus INT DEFAULT 0,
      deaths_verzik INT DEFAULT 0,

      hammer_bops INT DEFAULT 0,
      bgs_smacks INT DEFAULT 0,
      chally_pokes INT DEFAULT 0,
      uncharged_scythe_swings INT DEFAULT 0,
      ralos_autos INT DEFAULT 0,
      elder_maul_smacks INT DEFAULT 0,

      tob_barrages_without_proper_weapon INT DEFAULT 0,
      tob_verzik_p1_troll_specs INT DEFAULT 0,
      tob_verzik_p3_melees INT DEFAULT 0,

      chins_thrown_total INT DEFAULT 0,
      chins_thrown_black INT DEFAULT 0,
      chins_thrown_red INT DEFAULT 0,
      chins_thrown_grey INT DEFAULT 0,
      chins_thrown_maiden INT DEFAULT 0,
      chins_thrown_nylocas INT DEFAULT 0,
      chins_thrown_value INT DEFAULT 0,
      chins_thrown_incorrectly_maiden INT DEFAULT 0
    );
  `;

  await sql`
    CREATE INDEX idx_player_stats_player_id_date ON player_stats (player_id, date);
  `;
}

async function createQueryableEventsTable(sql: Sql) {
  await sql`
    CREATE TABLE queryable_events (
      challenge_id INT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      event_type SMALLINT NOT NULL,
      stage SMALLINT NOT NULL,
      mode SMALLINT DEFAULT 0,
      tick INT NOT NULL,
      x_coord SMALLINT NOT NULL,
      y_coord SMALLINT NOT NULL,
      subtype SMALLINT,
      player_id INT REFERENCES players (id) ON DELETE CASCADE,
      npc_id INT,
      custom_int_1 INT,
      custom_int_2 INT,
      custom_short_1 SMALLINT,
      custom_short_2 SMALLINT
    );
  `;

  await sql`
    CREATE INDEX idx_queryable_events_challenge_id ON queryable_events (challenge_id);
  `;
  await sql`
    CREATE INDEX idx_queryable_events_event_type_subtype ON queryable_events (event_type, subtype);
  `;
  await sql`
    CREATE INDEX idx_queryable_events_stage_mode ON queryable_events (stage, mode);
  `;
  await sql`
    CREATE INDEX idx_queryable_events_player_id ON queryable_events (player_id);
  `;
}
