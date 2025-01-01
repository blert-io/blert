import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TYPE gear_setup_state AS ENUM ('draft', 'published', 'archived')
  `;

  await sql`
    CREATE TABLE gear_setups (
      id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      author_id INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      public_id VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(128) NOT NULL,
      challenge_type INT NOT NULL,
      tags TEXT[],
      difficulty INT,
      state gear_setup_state NOT NULL DEFAULT 'draft',
      has_draft BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ,
      likes INT NOT NULL DEFAULT 0,
      dislikes INT NOT NULL DEFAULT 0,
      score INT GENERATED ALWAYS AS (likes - dislikes) STORED,
      views INT NOT NULL DEFAULT 0,
      latest_revision_id BIGINT
    )
  `;

  await sql`
    CREATE TABLE gear_setup_revisions (
      id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      setup_id BIGINT NOT NULL REFERENCES gear_setups (id) ON DELETE CASCADE,
      version INT NOT NULL,
      message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by INT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      UNIQUE (setup_id, version)
    )
  `;

  await sql`
    ALTER TABLE gear_setups 
      ADD CONSTRAINT fk_latest_revision 
      FOREIGN KEY (latest_revision_id) 
      REFERENCES gear_setup_revisions (id) 
      ON DELETE SET NULL
  `;

  await sql`
    CREATE INDEX idx_gear_setups_author_id ON gear_setups (author_id)
  `;

  await sql`
    CREATE INDEX idx_gear_setups_public_id ON gear_setups (public_id)
  `;

  await sql`
    CREATE INDEX idx_gear_setups_state ON gear_setups (state)
  `;

  await sql`
    CREATE INDEX idx_gear_setups_score ON gear_setups (score)
  `;

  await sql`
    CREATE INDEX idx_gear_setups_tags ON gear_setups USING GIN (tags)
  `;

  await sql`
    CREATE INDEX idx_gear_setup_revisions_setup_id ON gear_setup_revisions (setup_id)
  `;
}
