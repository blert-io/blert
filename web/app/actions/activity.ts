import {
  ACTIVITY_FEED_KEY,
  ActivityFeedItem as RedisActivityFeedItem,
  ActivityFeedItemType,
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

export async function getRecentFeedItems(limit: number = 10) {
  const client = await redis();
  const rawFeed: Array<RedisActivityFeedItem & { time: Date }> = await client
    .xRevRange(ACTIVITY_FEED_KEY, '+', '-', {
      COUNT: limit,
    })
    .then((items) =>
      items.map((item) => {
        const [timestamp, _] = item.id.split('-');
        const data = JSON.parse(item.message.data);
        return {
          type: parseInt(item.message.type),
          time: new Date(parseInt(timestamp)),
          data,
        };
      }),
    );

  const challengesToFetch = rawFeed
    .filter((item) => item.type === ActivityFeedItemType.CHALLENGE_END)
    .map((item) => item.data.challengeId);

  const [challenges, _] = await findChallenges(challengesToFetch.length, {
    uuid: challengesToFetch,
  });

  const feed: ActivityFeedItem[] = [];

  for (const item of rawFeed) {
    if (item.type === ActivityFeedItemType.CHALLENGE_END) {
      const challenge = challenges.find(
        (c) => c.uuid === item.data.challengeId,
      );
      if (challenge) {
        feed.push({
          type: item.type,
          time: item.time,
          challenge,
        } as ChallengeEndFeedItem);
      }
    }
  }

  return feed;
}

export async function getPlayersPerHour(startTime: Date) {
  const players = await sql`
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

export async function playerActivityByHour(username: string, startTime: Date) {
  const challenges = await sql`
    SELECT c.id, c.start_time
    FROM challenges c
    JOIN challenge_players cp ON c.id = cp.challenge_id
    JOIN players p ON cp.player_id = p.id
    WHERE LOWER(p.username) = ${username.toLowerCase()}
      AND c.start_time >= ${startTime}
  `;

  const byHour = new Array(24).fill(0);

  for (const challenge of challenges) {
    const hour = challenge.start_time.getUTCHours();
    byHour[hour]++;
  }

  return byHour;
}
