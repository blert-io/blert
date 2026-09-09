import { ChallengeMode, ChallengeType, SplitType } from '@blert/common';
import { describe, expect, it } from '@jest/globals';

import { formatRecordEmbed } from '../embed';

const BASE_URL = 'https://blert.io';
const UUID = 'f819eda1-1b85-4717-b13c-435f13e2c9c8';
const TIMESTAMP = new Date('2026-09-07T05:31:39.426Z');

const CHALLENGE = {
  uuid: UUID,
  type: ChallengeType.TOB,
  mode: ChallengeMode.TOB_REGULAR,
  scale: 4,
};

const PARTY = ['Sacolyn', '715', '1Ogp', 'WWWWWWWWWWQQ'];

describe('formatRecordEmbed', () => {
  it('announces a new record with its improvement over the previous time', () => {
    const embed = formatRecordEmbed(
      CHALLENGE,
      PARTY,
      {
        splitType: SplitType.TOB_REG_MAIDEN,
        newTicks: 132,
        previousRecord: 145,
        isTie: false,
      },
      BASE_URL,
      TIMESTAMP,
    );

    expect(embed).toEqual({
      title: 'New Record: Theatre of Blood (Regular) Maiden',
      color: 0xffd700,
      thumbnail: { url: 'https://blert.io/images/tob.webp' },
      url: `https://blert.io/raids/tob/${UUID}`,
      fields: [
        { name: 'Time', value: '`1:19.2`', inline: true },
        { name: 'Previous', value: '`1:27.0`', inline: true },
        { name: 'Δ', value: '`-7.8 (-13t)`', inline: true },
        { name: 'Scale', value: '4-player', inline: true },
        {
          name: 'Party',
          value: 'Sacolyn, 715, 1Ogp, and WWWWWWWWWWQQ',
          inline: false,
        },
      ],
      timestamp: '2026-09-07T05:31:39.426Z',
    });
  });

  it('announces a tie without a previous time or delta', () => {
    const embed = formatRecordEmbed(
      { ...CHALLENGE, mode: ChallengeMode.TOB_HARD, scale: 1 },
      ['aSaradomin'],
      {
        splitType: SplitType.TOB_HM_CHALLENGE,
        newTicks: 1000,
        previousRecord: 1000,
        isTie: true,
      },
      BASE_URL,
      TIMESTAMP,
    );

    expect(embed).toEqual({
      title: 'Record Tied: Theatre of Blood (Hard) Challenge time',
      color: 0xc0c0c0,
      thumbnail: { url: 'https://blert.io/images/tob.webp' },
      url: `https://blert.io/raids/tob/${UUID}`,
      fields: [
        { name: 'Time', value: '`10:00.0`', inline: true },
        { name: 'Scale', value: 'Solo', inline: true },
        { name: 'Party', value: 'aSaradomin', inline: false },
      ],
      timestamp: '2026-09-07T05:31:39.426Z',
    });
  });

  it('omits the previous time from the first ever record', () => {
    const embed = formatRecordEmbed(
      CHALLENGE,
      PARTY,
      {
        splitType: SplitType.TOB_REG_MAIDEN,
        newTicks: 132,
        previousRecord: null,
        isTie: false,
      },
      BASE_URL,
      TIMESTAMP,
    );

    expect(embed.fields).toEqual([
      { name: 'Time', value: '`1:19.2`', inline: true },
      { name: 'Scale', value: '4-player', inline: true },
      {
        name: 'Party',
        value: 'Sacolyn, 715, 1Ogp, and WWWWWWWWWWQQ',
        inline: false,
      },
    ]);
  });
});
