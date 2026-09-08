import {
  ACTIVITY_FEED_KEY,
  ActivityFeedItemType,
  ChallengeEndItem,
  ChallengeStatus,
} from '@blert/common';
import { RedisClientType } from 'redis';

import { challengeStatus } from '../challenges';
import { Sql } from '../db';
import { EffectEventKind } from '../effects';
import {
  DeliveryOutcome,
  EffectEvent,
  EffectHandler,
  SINGLE_MESSAGE_KEY,
} from '../runner';

/** Events older than this are not worth adding to the feed. */
const MAX_AGE_MS = 5 * 60 * 1000;

/** Approximate number of items retained in the feed stream. */
const FEED_MAX_LENGTH = 100;

/** Posts finished challenges to the home page activity feed. */
export class FeedHandler implements EffectHandler {
  public readonly key = 'feed';
  public readonly kinds: readonly EffectEventKind[] = [
    EffectEventKind.CHALLENGE_FINISHED,
  ];
  public readonly maxAge = MAX_AGE_MS;

  private readonly sql: Sql;
  private readonly redis: RedisClientType;

  public constructor(sql: Sql, redis: RedisClientType) {
    this.sql = sql;
    this.redis = redis;
  }

  public async plan(event: EffectEvent): Promise<string[]> {
    const status = await challengeStatus(this.sql, event.subject.uuid);
    if (status === null || status === ChallengeStatus.ABANDONED) {
      return [];
    }
    return [SINGLE_MESSAGE_KEY];
  }

  public async deliver(event: EffectEvent): Promise<DeliveryOutcome> {
    const item: ChallengeEndItem = { challengeId: event.subject.uuid };

    await this.redis.xAdd(
      ACTIVITY_FEED_KEY,
      '*',
      {
        type: ActivityFeedItemType.CHALLENGE_END.toString(),
        data: JSON.stringify(item),
      },
      {
        TRIM: {
          strategy: 'MAXLEN',
          strategyModifier: '~',
          threshold: FEED_MAX_LENGTH,
        },
      },
    );

    return { status: 'delivered' };
  }
}
