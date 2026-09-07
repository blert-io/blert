import {
  ACTIVITY_FEED_KEY,
  ActivityFeedItemType,
  ChallengeStatus,
} from '@blert/common';
import { describe, expect, it, jest } from '@jest/globals';
import { RedisClientType } from 'redis';

import { Sql } from '../../db';
import { EffectEventKind } from '../../effects';
import { EffectEvent, SINGLE_MESSAGE_KEY } from '../../runner';
import { FeedHandler } from '../feed';

const UUID = 'f819eda1-1b85-4717-b13c-435f13e2c9c8';

const EVENT: EffectEvent<EffectEventKind.CHALLENGE_FINISHED> = {
  id: 7n,
  kind: EffectEventKind.CHALLENGE_FINISHED,
  subject: { uuid: UUID },
  createdAt: new Date('2026-09-07T05:31:39.426Z'),
};

/** A database client whose queries resolve to `rows`. */
function makeSql(rows: object[]): Sql {
  return (() => Promise.resolve(rows)) as unknown as Sql;
}

function makeRedis() {
  const xAdd = jest
    .fn<(...args: unknown[]) => Promise<string>>()
    .mockResolvedValue('1-0');
  return { client: { xAdd } as unknown as RedisClientType, xAdd };
}

describe('FeedHandler', () => {
  describe('plan', () => {
    it.each([
      ChallengeStatus.COMPLETED,
      ChallengeStatus.RESET,
      ChallengeStatus.WIPED,
    ])('schedules one item for a challenge with status %i', async (status) => {
      const handler = new FeedHandler(
        makeSql([{ status }]),
        makeRedis().client,
      );

      await expect(handler.plan(EVENT)).resolves.toEqual([SINGLE_MESSAGE_KEY]);
    });

    it('schedules nothing for an abandoned challenge', async () => {
      const handler = new FeedHandler(
        makeSql([{ status: ChallengeStatus.ABANDONED }]),
        makeRedis().client,
      );

      await expect(handler.plan(EVENT)).resolves.toEqual([]);
    });

    it('schedules nothing for a missing challenge', async () => {
      const handler = new FeedHandler(makeSql([]), makeRedis().client);

      await expect(handler.plan(EVENT)).resolves.toEqual([]);
    });
  });

  it('adds a challenge to the feed stream on completion', async () => {
    const { client, xAdd } = makeRedis();

    const outcome = await new FeedHandler(makeSql([]), client).deliver(EVENT);

    expect(outcome).toEqual({ status: 'delivered' });
    expect(xAdd.mock.calls).toEqual([
      [
        ACTIVITY_FEED_KEY,
        '*',
        {
          type: ActivityFeedItemType.CHALLENGE_END.toString(),
          data: `{"challengeId":"${UUID}"}`,
        },
        {
          TRIM: {
            strategy: 'MAXLEN',
            strategyModifier: '~',
            threshold: 100,
          },
        },
      ],
    ]);
  });

  it('propagates a redis failure', async () => {
    const { client, xAdd } = makeRedis();
    xAdd.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      new FeedHandler(makeSql([]), client).deliver(EVENT),
    ).rejects.toThrow('connection lost');
  });
});
