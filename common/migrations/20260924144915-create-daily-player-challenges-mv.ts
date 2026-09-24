import { TransactionSql } from 'postgres';

import { ChallengeStatus } from '../challenge';
import { RecordingType } from '../user';

export async function migrate(sql: TransactionSql) {
  await sql.unsafe(`
    CREATE MATERIALIZED VIEW mv_daily_player_challenges AS
    SELECT
      cp.player_id,
      DATE(c.start_time) AS day_bucket,
      c.type AS challenge_type,
      c.mode AS challenge_mode,
      c.scale AS challenge_scale,
      COUNT(*)::int AS challenge_count,
      (COUNT(*) FILTER (WHERE c.status = ${ChallengeStatus.COMPLETED}))::int AS completions,
      (COUNT(*) FILTER (WHERE c.status = ${ChallengeStatus.WIPED}))::int AS wipes,
      (COUNT(*) FILTER (WHERE c.status = ${ChallengeStatus.RESET}))::int AS resets,
      SUM(CARDINALITY(cp.stage_deaths))::int AS deaths,
      COUNT(participant.challenge_id)::int AS participant_recordings
    FROM challenge_players cp
    JOIN challenges c ON c.id = cp.challenge_id
    LEFT JOIN (
      SELECT DISTINCT rc.challenge_id, ak.player_id
      FROM recorded_challenges rc
      JOIN api_keys ak ON ak.user_id = rc.recorder_id
      WHERE rc.recording_type = ${RecordingType.PARTICIPANT}
    ) participant
      ON participant.challenge_id = cp.challenge_id
      AND participant.player_id = cp.player_id
    WHERE c.status != ${ChallengeStatus.ABANDONED}
    GROUP BY cp.player_id, DATE(c.start_time), c.type, c.mode, c.scale
    WITH DATA
  `);

  await sql`
    CREATE UNIQUE INDEX uix_mv_daily_player_challenges
      ON mv_daily_player_challenges (
        player_id, day_bucket, challenge_type, challenge_mode, challenge_scale
      )
  `;

  await sql`
    CREATE INDEX idx_mv_daily_player_challenges_type_player
      ON mv_daily_player_challenges (challenge_type, player_id)
  `;
}
