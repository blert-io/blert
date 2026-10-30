import {
  ACTIVITY_FEED_KEY,
  ActivityFeedItem as RedisActivityFeedItem,
  ActivityFeedItemType,
  ActivityFeedData,
  ChallengeType,
  normalizeRsn,
} from '@blert/common';

import { ChallengeOverview, findChallenges } from './challenge';
import { sql } from './db';
import redis from './redis';

export interface ActivityFeedItem {
  type: ActivityFeedItemType;
  time: Date;
}

export interface ChallengeEndFeedItem extends ActivityFeedItem {
  type: ActivityFeedItemType.CHALLENGE_END;
  challenge: ChallengeOverview;
}

/**
 * How many times the requested limit to read to handle broken/missing items.
 */
const FEED_OVERREAD_FACTOR = 2;

function isChallengeEndItem(
  item: RedisActivityFeedItem,
): item is RedisActivityFeedItem & { data: ActivityFeedData } {
  return (
    item.type === ActivityFeedItemType.CHALLENGE_END &&
    typeof item.data === 'object' &&
    item.data !== null
  );
}

export async function getRecentFeedItems(limit: number = 10) {
  const client = await redis();
  const rawFeed: RedisActivityFeedItem[] = await client
    .xRevRange(ACTIVITY_FEED_KEY, '+', '-', {
      COUNT: limit * FEED_OVERREAD_FACTOR,
    })
    .then((items) =>
      items.map((item) => ({
        type: parseInt(item.message.type),
        data: JSON.parse(item.message.data) as ActivityFeedData,
      })),
    );

  // The stream is newest first, so the first entry for a challenge wins.
  const seen = new Set<string>();
  const challengeEndItems = rawFeed
    .filter(isChallengeEndItem)
    .filter((item) => {
      if (seen.has(item.data.challengeId)) {
        return false;
      }
      seen.add(item.data.challengeId);
      return true;
    });

  const challengesToFetch = challengeEndItems.map(
    (item) => item.data.challengeId,
  );

  const [challenges, _] = await findChallenges(challengesToFetch.length, {
    uuid: challengesToFetch,
  });

  const feed: ActivityFeedItem[] = [];

  for (const item of challengeEndItems) {
    const challenge = challenges.find((c) => c.uuid === item.data.challengeId);
    if (challenge === undefined) {
      continue;
    }
    if (challenge.finishTime === null) {
      continue;
    }
    feed.push({
      type: item.type,
      time: challenge.finishTime,
      challenge,
    } as ChallengeEndFeedItem);
  }

  return feed.slice(0, limit);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Counts the distinct players who started a challenge in each clock hour of
 * the last 24 hours.
 *
 * @param challengeType Optional challenge type to restrict the count to.
 * @returns 25 counts by hour, oldest first. The first and last are the partial
 *   hours at either end of the window.
 */
export async function getPlayersPerHour(
  challengeType?: ChallengeType,
): Promise<number[]> {
  const now = Date.now();
  const startTime = new Date(now - 24 * HOUR_MS);
  const firstHour = new Date(
    Math.floor(startTime.getTime() / HOUR_MS) * HOUR_MS,
  );

  const rows = await sql<{ bucket: number; players: number }[]>`
    SELECT
      FLOOR(EXTRACT(EPOCH FROM c.start_time - ${firstHour}) / 3600)::int AS bucket,
      COUNT(DISTINCT cp.player_id)::int AS players
    FROM challenges c
    JOIN challenge_players cp ON c.id = cp.challenge_id
    WHERE c.start_time >= ${startTime}
      AND c.start_time <= ${new Date(now)}
      ${challengeType !== undefined ? sql`AND c.type = ${challengeType}` : sql``}
    GROUP BY bucket
  `;

  const byHour = new Array<number>(25).fill(0);
  for (const { bucket, players } of rows) {
    byHour[bucket] = players;
  }
  return byHour;
}

type PlayerChallengeRow = {
  start_time: Date;
};

export async function playerActivityByHour(username: string, startTime: Date) {
  const challenges = await sql<PlayerChallengeRow[]>`
    SELECT c.id, c.start_time
    FROM challenges c
    JOIN challenge_players cp ON c.id = cp.challenge_id
    JOIN players p ON cp.player_id = p.id
    WHERE p.normalized_username = ${normalizeRsn(username)}
      AND c.start_time >= ${startTime}
  `;

  const byHour = new Array<number>(24).fill(0);

  for (const challenge of challenges) {
    const hour = challenge.start_time.getUTCHours();
    byHour[hour]++;
  }

  return byHour;
}
