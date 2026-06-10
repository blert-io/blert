import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    CREATE TABLE challenge_stage_merges (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      challenge_id INT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      stage SMALLINT NOT NULL,
      attempt SMALLINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      status SMALLINT NOT NULL,
      last_tick INT NOT NULL,
      missing_tick_count INT NOT NULL,
      precise_server_tick_count BOOLEAN NOT NULL,
      accurate_until INT NOT NULL,
      queryable_until INT NOT NULL,
      accurate_pct REAL GENERATED ALWAYS AS
        (accurate_until::REAL / (last_tick + 1)) STORED,
      queryable_pct REAL GENERATED ALWAYS AS
        (queryable_until::REAL / (last_tick + 1)) STORED,

      reference_method TEXT NOT NULL,
      reference_tick_count INT NOT NULL,

      merged_count SMALLINT NOT NULL,
      unmerged_count SMALLINT NOT NULL,
      skipped_count SMALLINT NOT NULL,

      alert_types TEXT[] NOT NULL DEFAULT '{}',
      capture_reasons TEXT[],
      capture_file TEXT
    )
  `;

  await sql`
    CREATE INDEX idx_challenge_stage_merges_challenge_id
      ON challenge_stage_merges (challenge_id, stage)
  `;
  await sql`
    CREATE INDEX idx_challenge_stage_merges_created_at
      ON challenge_stage_merges (created_at)
  `;
  await sql`
    CREATE INDEX idx_challenge_stage_merges_alert_types
      ON challenge_stage_merges USING GIN (alert_types)
  `;

  await sql`
    CREATE TABLE challenge_merge_clients (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      merge_id INT NOT NULL
        REFERENCES challenge_stage_merges (id) ON DELETE CASCADE,
      client_id INT NOT NULL,
      user_id INT,
      plugin_version TEXT,
      runelite_version TEXT,

      status TEXT NOT NULL,
      classification TEXT NOT NULL,

      recorded_ticks INT NOT NULL,
      server_tick_count INT,
      server_ticks_precise BOOLEAN,
      reported_accurate BOOLEAN NOT NULL,
      derived_accurate BOOLEAN NOT NULL,

      anomalies TEXT[] NOT NULL DEFAULT '{}',
      worst_segment_score REAL,
      quality_flag_counts JSONB NOT NULL DEFAULT '{}'
    )
  `;

  await sql`
    CREATE INDEX idx_challenge_merge_clients_merge_id
      ON challenge_merge_clients (merge_id)
  `;
  await sql`
    CREATE INDEX idx_challenge_merge_clients_client_id
      ON challenge_merge_clients (client_id)
  `;
  await sql`
    CREATE INDEX idx_challenge_merge_clients_anomalies
      ON challenge_merge_clients USING GIN (anomalies)
  `;
  await sql`
    CREATE INDEX idx_challenge_merge_clients_plugin_version
      ON challenge_merge_clients (plugin_version)
  `;
}
