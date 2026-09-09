import {
  Challenge,
  ChallengeMode,
  ChallengeType,
  SplitType,
  challengeName,
  splitName,
} from '@blert/common';

import { DiscordEmbed } from '../../delivery/discord';

// Discord embed colors.
const COLOR_GOLD = 0xffd700;
const COLOR_SILVER = 0xc0c0c0;

// Game tick duration in milliseconds.
const TICK_MS = 600;

type ChallengeInfo = Pick<Challenge, 'uuid' | 'type' | 'mode' | 'scale'>;

/** A record or tie set by one of a challenge's splits. */
export type Record = {
  splitType: SplitType;
  newTicks: number;
  /** The time beaten or tied. */
  previousRecord: number | null;
  isTie: boolean;
};

/**
 * Builds the Discord embed announcing a record.
 * @param challenge The challenge that set it.
 * @param party Usernames of the party, in orb order.
 * @param record The record or tie to announce.
 * @param baseUrl Blert base URL for the embed's links.
 * @param timestamp When the record was set.
 * @returns The embed.
 */
export function formatRecordEmbed(
  challenge: ChallengeInfo,
  party: string[],
  record: Record,
  baseUrl: string,
  timestamp: Date,
): DiscordEmbed {
  const challengeDisplayName = formatChallengeName(
    challenge.type,
    challenge.mode,
  );

  const title = record.isTie
    ? `Record Tied: ${challengeDisplayName} ${splitName(record.splitType)}`
    : `New Record: ${challengeDisplayName} ${splitName(record.splitType)}`;

  const fields: DiscordEmbed['fields'] = [
    {
      name: 'Time',
      value: '`' + formatTicks(record.newTicks) + '`',
      inline: true,
    },
  ];

  if (!record.isTie && record.previousRecord !== null) {
    fields.push({
      name: 'Previous',
      value: '`' + formatTicks(record.previousRecord) + '`',
      inline: true,
    });
    const deltaTicks = record.previousRecord - record.newTicks;
    fields.push({
      name: 'Δ',
      value: `\`-${formatTicks(deltaTicks)} (-${deltaTicks}t)\``,
      inline: true,
    });
  }

  fields.push({
    name: 'Scale',
    value: formatScale(challenge.type, challenge.scale),
    inline: true,
  });
  fields.push({
    name: 'Party',
    value: formatParty(party),
    inline: false,
  });

  return {
    title,
    color: record.isTie ? COLOR_SILVER : COLOR_GOLD,
    thumbnail: {
      url: `${baseUrl}${challengeLogo(challenge.type)}`,
    },
    url: `${baseUrl}${challengeUrl(challenge)}`,
    fields,
    timestamp: timestamp.toISOString(),
  };
}

function formatChallengeName(type: ChallengeType, mode: ChallengeMode): string {
  let name = challengeName(type);

  if (type === ChallengeType.TOB) {
    name += ` ${mode === ChallengeMode.TOB_REGULAR ? '(Regular)' : '(Hard)'}`;
  }

  return name;
}

function formatScale(type: ChallengeType, scale: number): string {
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

function formatTicks(ticks: number): string {
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

function challengeUrl(challenge: ChallengeInfo): string {
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
    case ChallengeType.MOKHAIOTL:
      return `/challenges/mokhaiotl/${challenge.uuid}`;
    default:
      return `/challenges/${challenge.uuid}`;
  }
}

function challengeLogo(type: ChallengeType): string {
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

function formatParty(party: string[]): string {
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
