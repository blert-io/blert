import { TransactionSql } from 'postgres';

export async function migrate(sql: TransactionSql) {
  await sql`
    CREATE TABLE tfa_challenge_stats (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      challenge_id INT NOT NULL UNIQUE REFERENCES challenges (id) ON DELETE CASCADE,
      route SMALLINT,
      guardian_deaths INT,
      ezekiel_deaths INT,
      bork_deaths INT,
      moia_deaths INT,
      dreadnoth_deaths INT,
      dagonhai_deaths INT,
      xarth_deaths INT,
      ocellus_deaths INT
    );
  `;

  await sql`
    CREATE INDEX idx_tfa_challenge_stats_route ON tfa_challenge_stats (route);
  `;
}
