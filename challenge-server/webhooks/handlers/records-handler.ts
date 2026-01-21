import {
  Challenge,
  ChallengeMode,
  ChallengeType,
  SplitType,
  challengeName,
  splitName,
} from '@blert/common';

import sql from '../../db';
import logger from '../../log';
import { DiscordClient, DiscordEmbed } from '../discord-client';
import { getTrackedSplits, shouldPostTies } from './records-config';
import { WebhookHandler } from '../webhook-service';

// Discord embed colors.
const COLOR_GOLD = 0xffd700;
const COLOR_SILVER = 0xc0c0c0;

// Game tick duration in milliseconds.
const TICK_MS = 600;

type ChallengeInfo = Pick<
  Challenge,
  'uuid' | 'type' | 'mode' | 'scale' | 'startTime' | 'finishTime'
> & { id: number };

type ChallengeSplit = {
  type: SplitType;
  ticks: number;
};

type RecordCheck = {
  splitType: SplitType;
  newTicks: number;
  previousRecord: number | null;
  isNewRecord: boolean;
  isTie: boolean;
};

/**
 * A webhook handler that detects new records and posts to Discord.
 */
export class RecordsHandler implements WebhookHandler {
  public readonly name = 'BlertRecordsHandler';

  private readonly discordClient: DiscordClient;
  private readonly webhookUrl: string | null;

  constructor(discordClient: DiscordClient) {
    this.discordClient = discordClient;
    this.webhookUrl = process.env.BLERT_DISCORD_RECORDS_WEBHOOK_URL ?? null;

    if (this.webhookUrl === null) {
      logger.warn('records_handler_no_webhook_url', {
        message:
          'BLERT_DISCORD_RECORDS_WEBHOOK_URL not set, records will not be posted',
      });
    }
  }

  public async onChallengeComplete(challengeUuid: string): Promise<void> {
    if (this.webhookUrl === null) {
      return;
    }

    const challenge = await this.loadChallenge(challengeUuid);
    if (challenge === null) {
      logger.warn('records_handler_challenge_not_found', { challengeUuid });
      return;
    }

    const splits = await this.loadChallengeSplits(challenge.id);
    if (splits.length === 0) {
      return;
    }

    const party = await this.loadChallengeParty(challenge.id);

    const records = await this.checkForRecords(
      challenge.id,
      splits,
      challenge.scale,
    );

    // Post notifications for each record.
    for (const record of records) {
      // Skip ties for splits that don't allow them.
      if (record.isTie && !shouldPostTies(record.splitType)) {
        continue;
      }

      const embed = this.formatRecordEmbed(challenge, party, record);
      await this.discordClient.enqueue(
        this.webhookUrl,
        {
          embeds: [embed],
        },
        {
          challengeUuid,
          splitType: record.splitType,
        },
      );
    }
  }

  private async loadChallenge(uuid: string): Promise<ChallengeInfo | null> {
    const [challenge] = await sql<[ChallengeInfo?]>`
      SELECT
        id,
        uuid,
        type,
        mode,
        status,
        scale,
        start_time as "startTime",
        finish_time as "finishTime"
      FROM challenges
      WHERE uuid = ${uuid}
    `;

    return challenge ?? null;
  }

  private async loadChallengeSplits(
    challengeId: number,
  ): Promise<ChallengeSplit[]> {
    const trackedSplits = getTrackedSplits();
    if (trackedSplits.length === 0) {
      return [];
    }

    return sql<ChallengeSplit[]>`
      SELECT type, ticks
      FROM challenge_splits
      WHERE
        challenge_id = ${challengeId}
        AND type = ANY(${trackedSplits})
        AND accurate = true
    `;
  }

  private async loadChallengeParty(challengeId: number): Promise<string[]> {
    const players = await sql<{ username: string }[]>`
      SELECT p.username
      FROM challenge_players cp
      JOIN players p ON cp.player_id = p.id
      WHERE cp.challenge_id = ${challengeId}
      ORDER BY cp.orb
    `;

    return players.map((p) => p.username);
  }

  private async checkForRecords(
    challengeId: number,
    splits: ChallengeSplit[],
    scale: number,
  ): Promise<RecordCheck[]> {
    if (splits.length === 0) {
      return [];
    }

    // Deduplicate splits by type.
    const splitsByType = new Map<SplitType, ChallengeSplit>();
    for (const split of splits) {
      splitsByType.set(split.type, split);
    }

    const uniqueSplits = Array.from(splitsByType.values());

    const currentRecords = await this.getCurrentRecords(
      challengeId,
      uniqueSplits.map((s) => s.type),
      scale,
    );

    // Compare each split against the current record.
    const records: RecordCheck[] = [];
    for (const split of uniqueSplits) {
      const currentRecord = currentRecords.get(split.type) ?? null;

      const isNewRecord = currentRecord === null || split.ticks < currentRecord;
      const isTie = currentRecord !== null && split.ticks === currentRecord;

      if (isNewRecord || isTie) {
        records.push({
          splitType: split.type,
          newTicks: split.ticks,
          previousRecord: currentRecord,
          isNewRecord,
          isTie,
        });
      }
    }

    return records;
  }

  private async getCurrentRecords(
    currentChallengeId: number,
    splitTypes: SplitType[],
    scale: number,
  ): Promise<Map<SplitType, number>> {
    const results = await sql<{ type: SplitType; ticks: number }[]>`
      SELECT type, MIN(ticks) as ticks
      FROM challenge_splits
      WHERE
        challenge_id != ${currentChallengeId}
        AND accurate = true
        AND scale = ${scale}
        AND type = ANY(${splitTypes})
      GROUP BY type
    `;

    const recordMap = new Map<SplitType, number>();
    for (const row of results) {
      recordMap.set(row.type, row.ticks);
    }

    return recordMap;
  }

  private formatRecordEmbed(
    challenge: ChallengeInfo,
    party: string[],
    record: RecordCheck,
  ): DiscordEmbed {
    const challengeDisplayName = this.formatChallengeName(
      challenge.type,
      challenge.mode,
    );

    const title = record.isTie
      ? `Record Tied: ${challengeDisplayName} ${splitName(record.splitType)}`
      : `New Record: ${challengeDisplayName} ${splitName(record.splitType)}`;

    const fields: DiscordEmbed['fields'] = [
      {
        name: 'Time',
        value: '`' + this.formatTicks(record.newTicks) + '`',
        inline: true,
      },
    ];

    if (!record.isTie && record.previousRecord !== null) {
      fields.push({
        name: 'Previous',
        value: '`' + this.formatTicks(record.previousRecord) + '`',
        inline: true,
      });
      const deltaTicks = record.previousRecord - record.newTicks;
      fields.push({
        name: 'Δ',
        value: `\`-${this.formatTicks(deltaTicks)} (-${deltaTicks}t)\``,
        inline: true,
      });
    }

    fields.push({
      name: 'Scale',
      value: this.formatScale(challenge.type, challenge.scale),
      inline: true,
    });
    fields.push({
      name: 'Party',
      value: party.join(', '),
      inline: false,
    });

    return {
      title,
      color: record.isTie ? COLOR_SILVER : COLOR_GOLD,
      thumbnail: {
        url: `${process.env.BLERT_BASE_URL}${this.challengeLogo(challenge.type)}`,
      },
      url: `${process.env.BLERT_BASE_URL}${this.challengeUrl(challenge)}`,
      fields,
      timestamp: (challenge.finishTime ?? challenge.startTime).toISOString(),
    };
  }

  private formatChallengeName(
    type: ChallengeType,
    mode: ChallengeMode,
  ): string {
    let name = challengeName(type);

    if (type === ChallengeType.TOB) {
      name += ` ${mode === ChallengeMode.TOB_REGULAR ? '(Regular)' : '(Hard)'}`;
    }

    return name;
  }

  private formatScale(type: ChallengeType, scale: number): string {
    switch (type) {
      case ChallengeType.TOA:
      case ChallengeType.TOB:
      case ChallengeType.COX:
        switch (scale) {
          case 1:
            return 'Solo';
          case 2:
            return 'Duo';
          case 3:
            return 'Trio';
          case 4:
            return '4-player';
          case 5:
            return '5-player';
          default:
            return `${scale}-player`;
        }
      case ChallengeType.COLOSSEUM:
      case ChallengeType.INFERNO:
      case ChallengeType.MOKHAIOTL:
        return 'Solo';
    }

    const _exhaustive: never = type;
    return scale.toString();
  }

  private formatTicks(ticks: number): string {
    const totalMs = ticks * TICK_MS;
    const totalSeconds = Math.floor(totalMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const tenths = Math.floor((totalMs % 1000) / 100);

    if (minutes > 0) {
      return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths}`;
    }
    return `${seconds}.${tenths}`;
  }

  private challengeUrl(challenge: ChallengeInfo): string {
    switch (challenge.type) {
      case ChallengeType.TOB:
        return `/raids/tob/${challenge.uuid}`;
      case ChallengeType.COX:
        return `/raids/cox/${challenge.uuid}`;
      case ChallengeType.TOA:
        return `/raids/toa/${challenge.uuid}`;
      case ChallengeType.COLOSSEUM:
        return `/challenges/colosseum/${challenge.uuid}`;
      case ChallengeType.INFERNO:
        return `/challenges/inferno/${challenge.uuid}`;
      default:
        return `/challenges/${challenge.uuid}`;
    }
  }

  private challengeLogo(type: ChallengeType): string {
    switch (type) {
      case ChallengeType.TOB:
        return `/images/tob.webp`;
      case ChallengeType.COX:
        return `/images/cox.webp`;
      case ChallengeType.TOA:
        return `/images/toa.webp`;
      case ChallengeType.COLOSSEUM:
        return `/images/colosseum.png`;
      case ChallengeType.INFERNO:
        return `/images/inferno.png`;
      case ChallengeType.MOKHAIOTL:
        return `/images/mokhaiotl.webp`;
    }
  }

  private formatParty(party: string[]): string {
    if (party.length === 1) {
      return party[0];
    }
    if (party.length === 2) {
      return party.join(' and ');
    }
    return (
      party.slice(0, party.length - 1).join(', ') +
      ', and ' +
      party[party.length - 1]
    );
  }
}
