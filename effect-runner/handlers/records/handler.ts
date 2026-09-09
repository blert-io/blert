import { Challenge, SplitType, splitName } from '@blert/common';

import { Sql } from '../../db';
import { DiscordWebhook } from '../../delivery/discord';
import { EffectEventKind } from '../../effects';
import logger from '../../log';
import { DeliveryOutcome, EffectEvent, EffectHandler } from '../../runner';

import { Record, formatRecordEmbed } from './embed';
import {
  shouldPostTies,
  trackedChallengeSplits,
  trackedStageSplits,
} from './splits';

/**
 * Everything needed to check a record.
 * The split fields are `null` if the challenge does not have the split.
 */
type AnnouncementRow = Pick<
  Challenge,
  'uuid' | 'type' | 'mode' | 'scale' | 'finishTime'
> & {
  ticks: number | null;
  previousRecord: number | null;
  currentRecord: number | null;
  party: string[] | null;
};

/** A challenge split with the record it would beat or tie. */
type SplitCandidate = {
  type: SplitType;
  ticks: number;
  /** Fastest time written before this split. */
  previousRecord: number | null;
};

/** Decides what record a split should announce. */
function recordFor(candidate: SplitCandidate): Record | null {
  const { type, ticks, previousRecord } = candidate;

  if (previousRecord === null || ticks < previousRecord) {
    return { splitType: type, newTicks: ticks, previousRecord, isTie: false };
  }
  if (ticks === previousRecord && shouldPostTies(type)) {
    return { splitType: type, newTicks: ticks, previousRecord, isTie: true };
  }
  return null;
}

const MESSAGE_KEY_PREFIX = 'split:';

function splitToKey(split: SplitType) {
  return `${MESSAGE_KEY_PREFIX}${split}`;
}

function splitFromKey(
  key: string,
  candidates: readonly SplitType[],
): SplitType | null {
  if (!key.startsWith(MESSAGE_KEY_PREFIX)) {
    return null;
  }
  const type = Number(key.slice(MESSAGE_KEY_PREFIX.length));
  return candidates.includes(type) ? type : null;
}

/** Announces new global records to a Discord webhook. */
export class RecordsHandler implements EffectHandler {
  public readonly key = 'discord.records';
  public readonly kinds: readonly EffectEventKind[] = [
    EffectEventKind.CHALLENGE_FINISHED,
    EffectEventKind.STAGE_FINISHED,
  ];

  private readonly sql: Sql;
  private readonly webhook: DiscordWebhook;
  private readonly baseUrl: string;

  /**
   * @param sql Database client.
   * @param webhook Destination for the announcements.
   * @param baseUrl Blert base URL for links.
   */
  public constructor(sql: Sql, webhook: DiscordWebhook, baseUrl: string) {
    this.sql = sql;
    this.webhook = webhook;
    this.baseUrl = baseUrl;
  }

  public async plan(event: EffectEvent): Promise<string[]> {
    const types = trackedSplitsOf(event);
    if (types.length === 0) {
      return [];
    }

    const candidates = await this.sql<SplitCandidate[]>`
      SELECT new.type, new.ticks, previous.ticks AS "previousRecord"
      FROM (
        SELECT DISTINCT ON (cs.type)
          cs.id, cs.type, cs.ticks, cs.scale, cs.challenge_id
        FROM challenge_splits cs
        JOIN challenges c ON c.id = cs.challenge_id
        WHERE c.uuid = ${event.subject.uuid}
          AND cs.type = ANY(${types as SplitType[]})
          AND cs.accurate
        ORDER BY cs.type, cs.ticks, cs.id
      ) new
      CROSS JOIN LATERAL (
        SELECT MIN(other.ticks) AS ticks
        FROM challenge_splits other
        WHERE other.type = new.type
          AND other.scale = new.scale
          AND other.accurate
          AND other.challenge_id <> new.challenge_id
          AND other.id < new.id
      ) previous
    `;

    return candidates
      .filter((candidate) => recordFor(candidate) !== null)
      .map((candidate) => splitToKey(candidate.type));
  }

  public async deliver(
    event: EffectEvent,
    messageKey: string,
  ): Promise<DeliveryOutcome> {
    const type = splitFromKey(messageKey, trackedSplitsOf(event));
    if (type === null) {
      return { status: 'failed', reason: `unknown message key ${messageKey}` };
    }

    const [row] = await this.sql<AnnouncementRow[]>`
      SELECT
        c.uuid,
        c.type,
        c.mode,
        c.scale,
        c.finish_time AS "finishTime",
        new.ticks,
        baseline.previous AS "previousRecord",
        baseline.current AS "currentRecord",
        (
          SELECT array_agg(p.username ORDER BY cp.orb)
          FROM challenge_players cp
          JOIN players p ON p.id = cp.player_id
          WHERE cp.challenge_id = c.id
        ) AS party
      FROM challenges c
      LEFT JOIN LATERAL (
        SELECT cs.id, cs.ticks, cs.scale
        FROM challenge_splits cs
        WHERE cs.challenge_id = c.id AND cs.type = ${type} AND cs.accurate
        ORDER BY cs.ticks, cs.id
        LIMIT 1
      ) new ON true
      LEFT JOIN LATERAL (
        SELECT
          MIN(other.ticks) FILTER (WHERE other.id < new.id) AS previous,
          MIN(other.ticks) AS current
        FROM challenge_splits other
        WHERE other.type = ${type}
          AND other.scale = new.scale
          AND other.accurate
          AND other.challenge_id <> c.id
      ) baseline ON true
      WHERE c.uuid = ${event.subject.uuid}
    `;

    if (row === undefined) {
      return { status: 'skipped', reason: 'challenge deleted' };
    }
    if (row.ticks === null) {
      return {
        status: 'skipped',
        reason: `split ${splitName(type)} no longer accurate`,
      };
    }

    const record = recordFor({
      type,
      ticks: row.ticks,
      previousRecord: row.previousRecord,
    });
    if (record === null) {
      return {
        status: 'skipped',
        reason: `split ${splitName(type)} did not set a record`,
      };
    }
    if (row.currentRecord !== null && row.ticks > row.currentRecord) {
      return {
        status: 'skipped',
        reason: `split ${splitName(type)} has since been beaten`,
      };
    }

    const challenge = row;
    const party = row.party ?? [];
    const timestamp =
      event.kind === EffectEventKind.CHALLENGE_FINISHED &&
      challenge.finishTime !== null
        ? challenge.finishTime
        : event.createdAt;

    const outcome = await this.webhook.post({
      embeds: [
        formatRecordEmbed(challenge, party, record, this.baseUrl, timestamp),
      ],
    });

    if (outcome.status === 'delivered') {
      logger.info('record_posted', {
        uuid: challenge.uuid,
        split: splitName(type),
        ticks: record.newTicks,
        previous: record.previousRecord,
        tie: record.isTie,
      });
    }
    return outcome;
  }
}

function trackedSplitsOf(event: EffectEvent): readonly SplitType[] {
  switch (event.kind) {
    case EffectEventKind.CHALLENGE_FINISHED:
      return trackedChallengeSplits();
    case EffectEventKind.STAGE_FINISHED:
      return trackedStageSplits(event.subject.stage);
  }
}
