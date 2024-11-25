import { Sql } from 'postgres';

export async function migrate(sql: Sql) {
  await sql`
    CREATE TABLE tob_challenge_stats (
      id INT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      challenge_id INT NOT NULL REFERENCES challenges (id) ON DELETE CASCADE,
      maiden_deaths INT DEFAULT 0,
      maiden_full_leaks INT,
      maiden_scuffed_spawns BOOLEAN DEFAULT FALSE,
      bloat_deaths INT DEFAULT 0,
      bloat_first_down_hp_percent REAL,
      nylocas_deaths INT DEFAULT 0,
      nylocas_pre_cap_stalls INT,
      nylocas_post_cap_stalls INT,
      nylocas_stalls INT[31],
      nylocas_mage_splits INT DEFAULT 0,
      nylocas_ranged_splits INT DEFAULT 0,
      nylocas_melee_splits INT DEFAULT 0,
      nylocas_boss_mage INT DEFAULT 0,
      nylocas_boss_ranged INT DEFAULT 0,
      nylocas_boss_melee INT DEFAULT 0,
      sotetseg_deaths INT DEFAULT 0,
      xarpus_deaths INT DEFAULT 0,
      xarpus_healing INT,
      verzik_deaths INT DEFAULT 0,
      verzik_reds_count INT,
      verzik_bounces INT
    );
  `;
}
