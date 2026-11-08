/**
 * @jest-environment jsdom
 */
import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SessionStatus,
  Stage,
} from '@blert/common';
import { render } from '@testing-library/react';

import type { SessionWithStats } from '@/actions/challenge';

import SessionContextProvider from '../session-context-provider';
import StageStats from '../stage-stats';

describe('StageStats', () => {
  it('counts each TFA room toward the raids that recorded it', () => {
    const session: SessionWithStats = {
      uuid: '11111111-1111-1111-1111-111111111111',
      challengeType: ChallengeType.TFA,
      challengeMode: ChallengeMode.NO_MODE,
      scale: 2,
      startTime: new Date('2026-11-08T20:47Z'),
      endTime: new Date('2026-11-08T21:28Z'),
      status: SessionStatus.COMPLETED,
      party: ['Player 1', 'Player 2'],
      challenges: [
        // A full raid through Ezekiel, Moia and The Dagon'hai.
        {
          uuid: '22222222-2222-2222-2222-222222222222',
          type: ChallengeType.TFA,
          status: ChallengeStatus.COMPLETED,
          mode: ChallengeMode.NO_MODE,
          stage: Stage.TFA_OCELLUS,
          scale: 2,
          startTime: new Date('2026-11-08T20:47Z'),
          finishTime: new Date('2026-11-08T21:03Z'),
          challengeTicks: 1468,
          overallTicks: 1607,
          totalDeaths: 0,
          party: [],
          splits: {},
          personalBests: [],
          tfaStats: {
            route: 0b000,
            guardianDeaths: 0,
            guardianDownCount: 2,
            ezekielDeaths: 0,
            borkDeaths: null,
            moiaDeaths: 0,
            dreadnothDeaths: null,
            dagonhaiDeaths: 0,
            xarthDeaths: null,
            ocellusDeaths: 0,
          },
        },
        // A recording that starts at Moia, so its route is unknown.
        {
          uuid: '33333333-3333-3333-3333-333333333333',
          type: ChallengeType.TFA,
          status: ChallengeStatus.COMPLETED,
          mode: ChallengeMode.NO_MODE,
          stage: Stage.TFA_OCELLUS,
          scale: 2,
          startTime: new Date('2026-11-08T21:10Z'),
          finishTime: new Date('2026-11-08T21:19Z'),
          challengeTicks: 815,
          overallTicks: 1514,
          totalDeaths: 1,
          party: [],
          splits: {},
          personalBests: [],
          tfaStats: {
            route: null,
            guardianDeaths: null,
            guardianDownCount: null,
            ezekielDeaths: null,
            borkDeaths: null,
            moiaDeaths: 0,
            dreadnothDeaths: null,
            dagonhaiDeaths: 1,
            xarthDeaths: null,
            ocellusDeaths: 0,
          },
        },
        // A wipe at Dreadnoth after Bork.
        {
          uuid: '44444444-4444-4444-4444-444444444444',
          type: ChallengeType.TFA,
          status: ChallengeStatus.WIPED,
          mode: ChallengeMode.NO_MODE,
          stage: Stage.TFA_DREADNOTH,
          scale: 2,
          startTime: new Date('2026-11-08T21:20Z'),
          finishTime: new Date('2026-11-08T21:28Z'),
          challengeTicks: 734,
          overallTicks: 812,
          totalDeaths: 2,
          party: [],
          splits: {},
          personalBests: [],
          tfaStats: {
            route: 0b11,
            guardianDeaths: 0,
            guardianDownCount: 2,
            ezekielDeaths: null,
            borkDeaths: 0,
            moiaDeaths: null,
            dreadnothDeaths: 2,
            dagonhaiDeaths: null,
            xarthDeaths: null,
            ocellusDeaths: null,
          },
        },
      ],
      stats: {
        challenges: 3,
        completions: 2,
        wipes: 1,
        resets: 0,
        deaths: 3,
        completionRate: (2 / 3) * 100,
        minCompletionTicks: 1514,
        maxCompletionTicks: 1607,
        avgCompletionTicks: 1561,
        personalBests: 0,
      },
      playerStats: [
        {
          username: 'Player 1',
          deaths: 2,
          deathsByStage: { [Stage.TFA_DAGONHAI]: 1, [Stage.TFA_DREADNOTH]: 1 },
          personalBests: [],
        },
        {
          username: 'Player 2',
          deaths: 1,
          deathsByStage: { [Stage.TFA_DREADNOTH]: 1 },
          personalBests: [],
        },
      ],
    };

    const { container } = render(
      <SessionContextProvider uuid={session.uuid} initialData={session}>
        <StageStats />
      </SessionContextProvider>,
    );

    const cards = Array.from(container.querySelectorAll('.stageCard')).map(
      (card) => card.textContent,
    );
    expect(cards).toEqual([
      'Guardian2 attempts100%Clears0Deaths',
      'Ezekiel1 attempt100%Clears0Deaths',
      'Bork1 attempt100%Clears0Deaths',
      'Moia2 attempts100%Clears0Deaths',
      'Dreadnoth1 attempt0%Clears2DeathsNo completions',
      "The Dagon'hai2 attempts100%Clears1Deaths",
      'Ocellus2 attempts100%Clears0Deaths',
    ]);
  });
});
