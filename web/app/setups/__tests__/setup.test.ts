import { ChallengeType } from '@blert/common';

import { GearSetup, setupScale, Spellbook } from '../setup';

describe('setupScale', () => {
  const baseSetup: GearSetup = {
    title: 'Test Setup',
    description: '',
    challenge: ChallengeType.TOB,
    players: [],
  };

  function emptyPlayer(name: string, optional: boolean = false) {
    return {
      name,
      spellbook: Spellbook.STANDARD,
      inventory: { slots: [] },
      equipment: { slots: [] },
      pouch: { slots: [] },
      optional,
    };
  }

  it('handles setups without optional players', () => {
    expect(setupScale(baseSetup)).toBe(0);

    const setup = {
      ...baseSetup,
      players: [
        emptyPlayer('Player 1'),
        emptyPlayer('Player 2'),
        emptyPlayer('Player 3'),
      ],
    };
    expect(setupScale(setup)).toBe(3);
  });

  it('handles setups with optional players', () => {
    const setup = {
      ...baseSetup,
      players: [
        emptyPlayer('Player 1'),
        emptyPlayer('Player 2', true),
        emptyPlayer('Player 3', true),
        emptyPlayer('Player 4'),
      ],
    };
    expect(setupScale(setup)).toBe(2);

    const allOptionalSetup = {
      ...baseSetup,
      players: [
        emptyPlayer('Player 1', true),
        emptyPlayer('Player 2', true),
        emptyPlayer('Player 3', true),
        emptyPlayer('Player 4', true),
      ],
    };
    expect(setupScale(allOptionalSetup)).toBe(0);
  });
});
