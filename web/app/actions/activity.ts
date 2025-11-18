import {
  ACTIVITY_FEED_KEY,
  ActivityFeedItem as RedisActivityFeedItem,
  ActivityFeedItemType,
  ActivityFeedData,
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

type ParsedActivityFeedItem = RedisActivityFeedItem & {
  time: Date;
};

function isChallengeEndItem(
  item: ParsedActivityFeedItem,
): item is ParsedActivityFeedItem & { data: ActivityFeedData } {
  return (
    item.type === ActivityFeedItemType.CHALLENGE_END &&
    typeof item.data === 'object' &&
    item.data !== null
  );
}

export async function getRecentFeedItems(limit: number = 10) {
  const client = await redis();
  const rawFeed: ParsedActivityFeedItem[] = await client
    .xRevRange(ACTIVITY_FEED_KEY, '+', '-', {
      COUNT: limit,
    })
    .then((items) =>
      items.map((item) => {
        const [timestamp] = item.id.split('-');
        const parsedData = JSON.parse(item.message.data) as ActivityFeedData;
        return {
          type: parseInt(item.message.type),
          time: new Date(parseInt(timestamp)),
          data: parsedData,
        };
      }),
    );

  const challengeEndItems = rawFeed.filter(isChallengeEndItem);

  const challengesToFetch = challengeEndItems.map(
    (item) => item.data.challengeId,
  );

  const [challenges, _] = await findChallenges(challengesToFetch.length, {
    uuid: challengesToFetch,
  });

  const feed: ActivityFeedItem[] = [];

  for (const item of challengeEndItems) {
    const challenge = challenges.find((c) => c.uuid === item.data.challengeId);
    if (challenge) {
      feed.push({
        type: item.type,
        time: item.time,
        challenge,
      } as ChallengeEndFeedItem);
    }
  }

  return feed;
}

type ChallengePlayerRow = {
  start_time: Date;
  player_id: string;
};

export async function getPlayersPerHour(startTime: Date) {
  const players = await sql<ChallengePlayerRow[]>`
    SELECT c.id, c.start_time, cp.player_id
    FROM challenges c
    JOIN challenge_players cp ON c.id = cp.challenge_id
    WHERE c.start_time >= ${startTime}
  `;

  const byHour = Array.from({ length: 25 }, () => new Set<string>());

  for (const player of players) {
    let hour = player.start_time.getUTCHours() - startTime.getUTCHours();
    if (hour < 0) {
      hour += 24;
    } else if (
      hour === 0 &&
      player.start_time.getUTCDate() !== startTime.getUTCDate()
    ) {
      // Distinguish between this hour yesterday and this hour today using a
      // 25th hour.
      hour = 24;
    }
    byHour[hour].add(player.player_id);
  }

  return byHour.map((h) => h.size);
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
    WHERE LOWER(p.username) = ${username.toLowerCase()}
      AND c.start_time >= ${startTime}
  `;

  const byHour = new Array<number>(24).fill(0);

  for (const challenge of challenges) {
    const hour = challenge.start_time.getUTCHours();
    byHour[hour]++;
  }

  return byHour;
}
