import { ChallengeStatus, Stage } from '@blert/common';

import { bossState } from '../boss-route';

const STAGES = [
  Stage.TFA_GUARDIAN,
  Stage.TFA_EZEKIEL,
  Stage.TFA_BORK,
  Stage.TFA_MOIA,
  Stage.TFA_DREADNOTH,
  Stage.TFA_DAGONHAI,
  Stage.TFA_XARTH,
  Stage.TFA_OCELLUS,
];

describe('bossState', () => {
  it('marks each defeated boss as completed, and the other boss in its row as not chosen', () => {
    const raid = {
      status: ChallengeStatus.COMPLETED,
      stage: Stage.TFA_OCELLUS,
      tfa: {
        bosses: [
          { stage: Stage.TFA_GUARDIAN, ticksLost: 0, npcs: {}, deaths: [] },
          { stage: Stage.TFA_EZEKIEL, ticksLost: 0, npcs: {}, deaths: [] },
          { stage: Stage.TFA_MOIA, ticksLost: 0, npcs: {}, deaths: [] },
          { stage: Stage.TFA_XARTH, ticksLost: 0, npcs: {}, deaths: [] },
          {
            stage: Stage.TFA_OCELLUS,
            ticksLost: 0,
            npcs: {},
            deaths: ['Player 1', 'Player 2'],
          },
        ],
      },
    };
    expect(STAGES.map((stage) => bossState(raid, stage, null))).toEqual([
      'completed',
      'completed',
      'notChosen',
      'completed',
      'notChosen',
      'notChosen',
      'completed',
      'completed',
    ]);
  });

  it('marks both bosses in a row as missing when neither was recorded', () => {
    const raid = {
      status: ChallengeStatus.WIPED,
      stage: Stage.TFA_DREADNOTH,
      tfa: {
        bosses: [
          { stage: Stage.TFA_GUARDIAN, ticksLost: 0, npcs: {}, deaths: [] },
          {
            stage: Stage.TFA_DREADNOTH,
            ticksLost: 0,
            npcs: {},
            deaths: ['Player 1', 'Player 2'],
          },
        ],
      },
    };
    expect(STAGES.map((stage) => bossState(raid, stage, null))).toEqual([
      'completed',
      'missing',
      'missing',
      'notChosen',
      'wiped',
      'notReached',
      'notReached',
      'notReached',
    ]);
  });

  it('marks every boss after the one the party reset on as not reached', () => {
    const raid = {
      status: ChallengeStatus.RESET,
      stage: Stage.TFA_EZEKIEL,
      tfa: {
        bosses: [
          { stage: Stage.TFA_GUARDIAN, ticksLost: 0, npcs: {}, deaths: [] },
          {
            stage: Stage.TFA_EZEKIEL,
            ticksLost: 0,
            npcs: {},
            deaths: ['Player 1'],
          },
        ],
      },
    };
    expect(STAGES.map((stage) => bossState(raid, stage, null))).toEqual([
      'completed',
      'reset',
      'notChosen',
      'notReached',
      'notReached',
      'notReached',
      'notReached',
      'notReached',
    ]);
  });

  it('marks the active boss as live, and both bosses in the next row as next', () => {
    const raid = {
      status: ChallengeStatus.IN_PROGRESS,
      stage: Stage.TFA_MOIA,
      tfa: {
        bosses: [
          { stage: Stage.TFA_GUARDIAN, ticksLost: 0, npcs: {}, deaths: [] },
          { stage: Stage.TFA_EZEKIEL, ticksLost: 0, npcs: {}, deaths: [] },
        ],
      },
    };
    expect(
      STAGES.map((stage) => bossState(raid, stage, Stage.TFA_MOIA)),
    ).toEqual([
      'completed',
      'completed',
      'notChosen',
      'live',
      'notChosen',
      'next',
      'next',
      'notReached',
    ]);
  });

  it('marks both bosses in the next row as next while the party is between bosses', () => {
    const raid = {
      status: ChallengeStatus.IN_PROGRESS,
      stage: Stage.TFA_EZEKIEL,
      tfa: {
        bosses: [
          { stage: Stage.TFA_GUARDIAN, ticksLost: 0, npcs: {}, deaths: [] },
          { stage: Stage.TFA_EZEKIEL, ticksLost: 0, npcs: {}, deaths: [] },
        ],
      },
    };
    expect(STAGES.map((stage) => bossState(raid, stage, null))).toEqual([
      'completed',
      'completed',
      'notChosen',
      'next',
      'next',
      'notReached',
      'notReached',
      'notReached',
    ]);
  });
});
