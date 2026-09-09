import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SplitType,
  Stage,
} from '@blert/common';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'crypto';

import { DiscordWebhook } from '../../delivery/discord';
import { EffectEventKind } from '../../effects';
import { RecordsHandler } from '../../handlers/records';
import { EffectEvent } from '../../runner';
import { sql, truncateTables } from './setup';

async function insertRun(
  type: SplitType,
  ticks: number,
  { accurate = true, scale = 4 } = {},
): Promise<string> {
  const uuid = randomUUID();
  const [challenge] = await sql<{ id: number }[]>`
    INSERT INTO challenges (uuid, type, mode, status, scale, start_time)
    VALUES (
      ${uuid},
      ${ChallengeType.TOB},
      ${ChallengeMode.TOB_REGULAR},
      ${ChallengeStatus.COMPLETED},
      ${scale},
      NOW()
    )
    RETURNING id
  `;
  await sql`
    INSERT INTO challenge_splits (challenge_id, type, scale, ticks, accurate)
    VALUES (${challenge.id}, ${type}, ${scale}, ${ticks}, ${accurate})
  `;

  for (let orb = 0; orb < scale; orb++) {
    const username = `${uuid.slice(0, 6)}-${orb}`;
    const [player] = await sql<{ id: number }[]>`
      INSERT INTO players (username, normalized_username)
      VALUES (${username}, ${username.toLowerCase()})
      RETURNING id
    `;
    await sql`
      INSERT INTO challenge_players
        (challenge_id, player_id, username, orb, primary_gear)
      VALUES (${challenge.id}, ${player.id}, ${username}, ${orb}, 0)
    `;
  }

  return uuid;
}

function expectedPartyOf(uuid: string, scale: number): string {
  const names = Array.from(
    { length: scale },
    (_, orb) => `${uuid.slice(0, 6)}-${orb}`,
  );
  return `${names.slice(0, -1).join(', ')}, and ${names[scale - 1]}`;
}

function challengeFinished(uuid: string): EffectEvent {
  return {
    id: 1n,
    kind: EffectEventKind.CHALLENGE_FINISHED,
    subject: { uuid },
    createdAt: new Date(),
  };
}

function stageFinished(uuid: string, stage: Stage): EffectEvent {
  return {
    id: 2n,
    kind: EffectEventKind.STAGE_FINISHED,
    subject: { uuid, stage, attempt: null },
    createdAt: new Date(),
  };
}

function makeHandler() {
  const post = jest
    .fn<DiscordWebhook['post']>()
    .mockResolvedValue({ status: 'delivered' });
  const handler = new RecordsHandler(
    sql,
    { post } as unknown as DiscordWebhook,
    'https://blert.io',
  );
  return { handler, post };
}

describe('RecordsHandler', () => {
  beforeEach(async () => {
    await truncateTables();
  });

  describe('plan', () => {
    it('announces the first ever time of a split', async () => {
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 120);

      const keys = await makeHandler().handler.plan(
        stageFinished(uuid, Stage.TOB_MAIDEN),
      );

      expect(keys).toEqual([`split:${SplitType.TOB_REG_MAIDEN}`]);
    });

    it('announces a time faster than every earlier one', async () => {
      await insertRun(SplitType.TOB_REG_MAIDEN, 145);
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 115);

      const keys = await makeHandler().handler.plan(
        stageFinished(uuid, Stage.TOB_MAIDEN),
      );

      expect(keys).toEqual([`split:${SplitType.TOB_REG_MAIDEN}`]);
    });

    it('ignores a time slower than an earlier one', async () => {
      await insertRun(SplitType.TOB_REG_MAIDEN, 115);
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 130);

      const keys = await makeHandler().handler.plan(
        stageFinished(uuid, Stage.TOB_MAIDEN),
      );

      expect(keys).toEqual([]);
    });

    it('announces a tie of a split whose ties are posted', async () => {
      await insertRun(SplitType.TOB_REG_OVERALL, 1500);
      const uuid = await insertRun(SplitType.TOB_REG_OVERALL, 1500);

      const keys = await makeHandler().handler.plan(challengeFinished(uuid));

      expect(keys).toEqual([`split:${SplitType.TOB_REG_OVERALL}`]);
    });

    it('ignores a tie of a split whose ties are not posted', async () => {
      await insertRun(SplitType.TOB_REG_MAIDEN, 110);
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 110);

      const keys = await makeHandler().handler.plan(
        stageFinished(uuid, Stage.TOB_MAIDEN),
      );

      expect(keys).toEqual([]);
    });

    it('ignores an inaccurate split', async () => {
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 100, {
        accurate: false,
      });

      const keys = await makeHandler().handler.plan(
        stageFinished(uuid, Stage.TOB_MAIDEN),
      );

      expect(keys).toEqual([]);
    });

    it('compares only against times of the same scale', async () => {
      await insertRun(SplitType.TOB_REG_MAIDEN, 130, { scale: 3 });
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 130, { scale: 4 });

      const keys = await makeHandler().handler.plan(
        stageFinished(uuid, Stage.TOB_MAIDEN),
      );

      expect(keys).toEqual([`split:${SplitType.TOB_REG_MAIDEN}`]);
    });

    it('only considers challenge-wide splits on a CHALLENGE_FINISH', async () => {
      const uuid = await insertRun(SplitType.TOB_REG_BLOAT, 133);

      const keys = await makeHandler().handler.plan(challengeFinished(uuid));

      expect(keys).toEqual([]);
    });

    it('announces nothing for a deleted challenge', async () => {
      const keys = await makeHandler().handler.plan(
        challengeFinished(randomUUID()),
      );

      expect(keys).toEqual([]);
    });
  });

  describe('deliver', () => {
    it('posts the record to the webhook', async () => {
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 120);
      const { handler, post } = makeHandler();

      const outcome = await handler.deliver(
        stageFinished(uuid, Stage.TOB_MAIDEN),
        `split:${SplitType.TOB_REG_MAIDEN}`,
      );

      expect(outcome).toEqual({ status: 'delivered' });
      expect(post.mock.calls).toHaveLength(1);
    });

    it('skips a record beaten between planning and delivery', async () => {
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 120);
      const { handler, post } = makeHandler();
      await insertRun(SplitType.TOB_REG_MAIDEN, 105);

      const outcome = await handler.deliver(
        stageFinished(uuid, Stage.TOB_MAIDEN),
        `split:${SplitType.TOB_REG_MAIDEN}`,
      );

      expect(outcome).toEqual({
        status: 'skipped',
        reason: 'split Maiden has since been beaten',
      });
      expect(post.mock.calls).toHaveLength(0);
    });

    it('announces a record set before a slower later time', async () => {
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 120);
      await insertRun(SplitType.TOB_REG_MAIDEN, 130);
      const { handler, post } = makeHandler();

      const outcome = await handler.deliver(
        stageFinished(uuid, Stage.TOB_MAIDEN),
        `split:${SplitType.TOB_REG_MAIDEN}`,
      );

      const party = expectedPartyOf(uuid, 4);

      expect(outcome).toEqual({ status: 'delivered' });
      expect(post.mock.calls[0][0].embeds?.[0].fields).toEqual([
        { name: 'Time', value: '`1:12.0`', inline: true },
        { name: 'Scale', value: '4-player', inline: true },
        { name: 'Party', value: party, inline: false },
      ]);
    });

    it('posts a record that a later time tied', async () => {
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 120);
      await insertRun(SplitType.TOB_REG_MAIDEN, 120);
      const { handler, post } = makeHandler();

      const outcome = await handler.deliver(
        stageFinished(uuid, Stage.TOB_MAIDEN),
        `split:${SplitType.TOB_REG_MAIDEN}`,
      );

      expect(outcome).toEqual({ status: 'delivered' });
      expect(post.mock.calls[0][0].embeds?.[0].title).toEqual(
        'New Record: Theatre of Blood (Regular) Maiden',
      );
    });

    it('skips a nonexistent challenge', async () => {
      const { handler, post } = makeHandler();

      const outcome = await handler.deliver(
        challengeFinished(randomUUID()),
        `split:${SplitType.TOB_REG_OVERALL}`,
      );

      expect(outcome).toEqual({
        status: 'skipped',
        reason: 'challenge deleted',
      });
      expect(post.mock.calls).toHaveLength(0);
    });

    it('fails if the message key comes from the wrong event type', async () => {
      const uuid = await insertRun(SplitType.TOB_REG_MAIDEN, 120);
      const { handler, post } = makeHandler();

      const outcome = await handler.deliver(
        challengeFinished(uuid),
        `split:${SplitType.TOB_REG_MAIDEN}`,
      );

      expect(outcome).toEqual({
        status: 'failed',
        reason: `unknown message key split:${SplitType.TOB_REG_MAIDEN}`,
      });
      expect(post.mock.calls).toHaveLength(0);
    });
  });
});
