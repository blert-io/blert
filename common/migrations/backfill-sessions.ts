import postgres from 'postgres';
import { parseArgs } from 'util';

import {
  ChallengeMode,
  ChallengeType,
  SESSION_ACTIVITY_DURATION_MS,
  SessionStatus,
  Stage,
} from '../challenge';
import { partyHash, sessionKey } from '../db/redis';

type ActiveSession = {
  challenges: any[];
  party: string[];
  endTime: Date;
};

// Historic one-off migration script, will never be run again.
/* eslint-disable */

export async function scriptMain(sql: postgres.Sql, args: string[]) {
  // Finds all existing challenges in the database which are not associated with
  // a session, and groups them into sessions based on time and party.
  // For challenges without finish times set, assumes a finish time based on the
  // challenge's challenge ticks and stage, and sets the finish time field.
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
    },
    args,
  });

  const dryRun = values['dry-run'];
  const startTime = process.hrtime.bigint();

  const batchSize = 100;
  const activeSessions = new Map<string, ActiveSession>();
  let challengesProcessed = 0;
  let sessionsCreated = 0;

  let lastStartTime = new Date(0);
  let lastChallengeId = 0;

  while (true) {
    const challenges = await sql`
      SELECT * FROM challenges
      WHERE session_id IS NULL AND (start_time, id) > (${lastStartTime}, ${lastChallengeId})
      ORDER BY start_time ASC, id ASC
      LIMIT ${batchSize}
    `;

    if (challenges.length === 0) {
      break;
    }

    const parties = await loadChallengeParties(
      sql,
      challenges.map((c) => c.id),
    );

    const challengeUpdates: postgres.Fragment[] = [];
    for (const challenge of challenges) {
      if (challenge.finish_time === null) {
        const finishTime = assumeFinishTime(challenge);
        challenge.finish_time = finishTime;
        if (dryRun) {
          console.log(
            `Setting finish time for challenge ${challenge.id} to ${finishTime.toISOString()}`,
          );
        } else {
          challengeUpdates.push(
            sql`
              UPDATE challenges
              SET finish_time = ${finishTime}
              WHERE id = ${challenge.id}
            `,
          );
        }
      }
    }

    if (!dryRun && challengeUpdates.length > 0) {
      const numUpdates = challengeUpdates.length;
      await Promise.all(challengeUpdates);
      console.log(`Set finish time for ${numUpdates} challenges`);
    }

    for (const challenge of challenges) {
      await flushExpiredSessions(
        sql,
        activeSessions,
        challenge.start_time,
        dryRun,
      );

      const sk = sessionKey(challenge.type, parties[challenge.id]);
      const existingSession = activeSessions.get(sk);

      if (existingSession) {
        existingSession.challenges.push(challenge);
        existingSession.endTime = challenge.finish_time;
      } else {
        sessionsCreated++;
        activeSessions.set(sk, {
          challenges: [challenge],
          party: parties[challenge.id],
          endTime: challenge.finish_time,
        });
      }
    }

    const lastChallenge = challenges[challenges.length - 1];
    lastStartTime = lastChallenge.start_time;
    lastChallengeId = lastChallenge.id;
    challengesProcessed += challenges.length;

    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1e6;

    console.log(
      `Processed ${challenges.length} challenges in ${elapsedMs.toFixed(0)}ms. ` +
        `Total processed: ${challengesProcessed}. ` +
        `Now at timestamp: ${lastStartTime.toISOString()}`,
    );
  }

  if (activeSessions.size > 0) {
    console.log(`Flushing remaining ${activeSessions.size} sessions...`);
    await flushExpiredSessions(sql, activeSessions, null, dryRun);
  }

  const endTime = process.hrtime.bigint();
  console.log(
    `Grouped ${challengesProcessed} challenges into ${sessionsCreated} ` +
      `sessions in ${formatDuration(endTime - startTime)}`,
  );
}

function formatDuration(nanoseconds: bigint): string {
  const seconds = Number(nanoseconds) / 1e9;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(2)}s`;
}

async function loadChallengeParties(
  sql: postgres.Sql,
  challengeIds: number[],
): Promise<Record<number, string[]>> {
  const players = await sql`
    SELECT challenge_id, username
    FROM challenge_players
    WHERE challenge_id = ANY(${challengeIds})
    ORDER BY orb
  `;

  return players.reduce((acc, player) => {
    if (acc[player.challenge_id] === undefined) {
      acc[player.challenge_id] = [player.username];
    } else {
      acc[player.challenge_id].push(player.username);
    }
    return acc;
  }, []);
}

async function flushExpiredSessions(
  sql: postgres.Sql,
  activeSessions: Map<string, ActiveSession>,
  now: Date | null,
  dryRun: boolean,
) {
  const flushPromises = [];
  for (const [sk, session] of activeSessions) {
    if (
      now === null ||
      session.endTime.getTime() <= now.getTime() - SESSION_ACTIVITY_DURATION_MS
    ) {
      flushPromises.push(writeSession(sql, sk, session, dryRun));
      activeSessions.delete(sk);
    }
  }
  await Promise.all(flushPromises);
}

async function writeSession(
  sql: postgres.Sql,
  sk: string,
  session: ActiveSession,
  dryRun: boolean,
) {
  if (session.challenges.length === 0) {
    console.log(`Skipping ${sk}`);
    return;
  }

  const firstChallenge = session.challenges[0];
  const lastChallenge = session.challenges[session.challenges.length - 1];

  const modeCounts = session.challenges.reduce(
    (acc, challenge) => {
      acc[challenge.mode] = (acc[challenge.mode] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  let mostFrequentMode: ChallengeMode;
  let maxCount = 0;
  for (const mode in modeCounts) {
    const count = modeCounts[mode];
    if (count > maxCount) {
      mostFrequentMode = parseInt(mode) as ChallengeMode;
      maxCount = count;
    }
  }

  if (dryRun) {
    console.log(
      `Writing session startTime=${firstChallenge.start_time.toISOString()}, ` +
        `endTime=${lastChallenge.finish_time.toISOString()}, ` +
        `scale=${session.party.length}, ` +
        `mode=${mostFrequentMode!}, ` +
        `challenges=${session.challenges.length}, ` +
        `party=${session.party.join(',')}`,
    );
  } else {
    await sql.begin(async (tx) => {
      const [newSession] = await tx`
        INSERT INTO challenge_sessions(
          uuid,
          challenge_type,
          challenge_mode,
          scale,
          party_hash,
          start_time,
          end_time,
          status
        ) VALUES (
          ${firstChallenge.uuid},
          ${firstChallenge.type},
          ${mostFrequentMode!},
          ${session.party.length},
          ${partyHash(session.party)},
          ${firstChallenge.start_time},
          ${lastChallenge.finish_time},
          ${SessionStatus.COMPLETED}
        )
        RETURNING id
      `;

      await tx`
        UPDATE challenges
        SET session_id = ${newSession.id}
        WHERE id = ANY(${session.challenges.map((c) => c.id)})
      `;
    });
  }
}

const TICK_MS = 600;

function assumeFinishTime(challenge: any): Date {
  if (challenge.overall_ticks !== null) {
    // Only ToB reports overall ticks, and the timer starts once the team enters
    // Maiden, so add 30 seconds of running to Maiden and prep.
    return new Date(
      challenge.start_time.getTime() +
        challenge.overall_ticks * TICK_MS +
        30_000,
    );
  }

  return new Date(
    challenge.start_time.getTime() +
      assumeChallengeDuration(
        challenge.type,
        challenge.stage,
        challenge.challenge_ticks,
      ),
  );
}

function assumeChallengeDuration(
  type: ChallengeType,
  stage: Stage,
  challengeTicks: number,
): number {
  let bufferMs = 0;

  switch (type) {
    case ChallengeType.TOB:
      // For TOB, use an estimated downtime before each room.
      const downtimes = [
        30_000, // Running through Maiden corridor and starting.
        30_000, // Running between Maiden and Bloat.
        45_000, // Buying at Bloat chest, running to Nylo, potshare, etc.
        30_000, // Running to Sote.
        45_000, // Buying at Sote chest and entering Xarpus.
        30_000, // Picking up staff, dropping items, starting Verzik.
      ];
      const stageNumber = stage - Stage.TOB_MAIDEN;
      bufferMs = downtimes.slice(0, stageNumber + 1).reduce((a, b) => a + b, 0);
      break;
    case ChallengeType.COLOSSEUM:
      // For Colosseum, assume 20 seconds of downtime before each stage.
      const stages = stage - Stage.COLOSSEUM_WAVE_1;
      bufferMs = stages * 20_000;
      break;
    default:
      // Only TOB and Colosseum existed before the session system was introduced.
      throw new Error(`Unsupported challenge type: ${type}`);
  }

  return challengeTicks * TICK_MS + bufferMs;
}
