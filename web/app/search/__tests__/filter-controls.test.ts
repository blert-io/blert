import { ChallengeMode, ChallengeType } from '@blert/common';

import { toggleNoModeType, toggleTobMode } from '../filter-controls';

describe('toggleTobMode', () => {
  it('adds the target mode and TOB type when neither is present', () => {
    const result = toggleTobMode([], [], ChallengeMode.TOB_REGULAR);
    expect(result.type).toEqual([ChallengeType.TOB]);
    expect(result.mode).toEqual([ChallengeMode.TOB_REGULAR]);
  });

  it('adds the target mode without duplicating the TOB type', () => {
    const result = toggleTobMode(
      [ChallengeType.TOB],
      [ChallengeMode.TOB_REGULAR],
      ChallengeMode.TOB_HARD,
    );
    expect(result.type).toEqual([ChallengeType.TOB]);
    expect(result.mode).toEqual([
      ChallengeMode.TOB_REGULAR,
      ChallengeMode.TOB_HARD,
    ]);
  });

  it('removes the target mode but keeps the TOB type when another TOB mode remains', () => {
    const result = toggleTobMode(
      [ChallengeType.TOB],
      [ChallengeMode.TOB_REGULAR, ChallengeMode.TOB_HARD],
      ChallengeMode.TOB_HARD,
    );
    expect(result.type).toEqual([ChallengeType.TOB]);
    expect(result.mode).toEqual([ChallengeMode.TOB_REGULAR]);
  });

  it('removes TOB from type when the last TOB mode is removed', () => {
    const result = toggleTobMode(
      [ChallengeType.TOB],
      [ChallengeMode.TOB_REGULAR],
      ChallengeMode.TOB_REGULAR,
    );
    expect(result.type).toEqual([]);
    expect(result.mode).toEqual([]);
  });

  it('preserves unrelated types when toggling a TOB mode', () => {
    const result = toggleTobMode(
      [ChallengeType.TOB, ChallengeType.INFERNO],
      [ChallengeMode.TOB_REGULAR, ChallengeMode.NO_MODE],
      ChallengeMode.TOB_REGULAR,
    );
    expect(result.type).toEqual([ChallengeType.INFERNO]);
    expect(result.mode).toEqual([ChallengeMode.NO_MODE]);
  });
});

describe('toggleNoModeType', () => {
  it('adds the type and NO_MODE when neither is present', () => {
    const result = toggleNoModeType([], [], ChallengeType.INFERNO);
    expect(result.type).toEqual([ChallengeType.INFERNO]);
    expect(result.mode).toEqual([ChallengeMode.NO_MODE]);
  });

  it('does not duplicate NO_MODE if another no-mode type already set it', () => {
    const result = toggleNoModeType(
      [ChallengeType.INFERNO],
      [ChallengeMode.NO_MODE],
      ChallengeType.COLOSSEUM,
    );
    expect(result.type).toEqual([
      ChallengeType.INFERNO,
      ChallengeType.COLOSSEUM,
    ]);
    expect(result.mode).toEqual([ChallengeMode.NO_MODE]);
  });

  it('removes the type and NO_MODE when it was the only no-mode type', () => {
    const result = toggleNoModeType(
      [ChallengeType.INFERNO],
      [ChallengeMode.NO_MODE],
      ChallengeType.INFERNO,
    );
    expect(result.type).toEqual([]);
    expect(result.mode).toEqual([]);
  });

  it('keeps NO_MODE when another no-mode type remains', () => {
    const result = toggleNoModeType(
      [ChallengeType.INFERNO, ChallengeType.COLOSSEUM],
      [ChallengeMode.NO_MODE],
      ChallengeType.INFERNO,
    );
    expect(result.type).toEqual([ChallengeType.COLOSSEUM]);
    expect(result.mode).toEqual([ChallengeMode.NO_MODE]);
  });

  it('leaves other modes (e.g. TOB) untouched', () => {
    const result = toggleNoModeType(
      [ChallengeType.TOB, ChallengeType.INFERNO],
      [ChallengeMode.TOB_REGULAR, ChallengeMode.NO_MODE],
      ChallengeType.INFERNO,
    );
    expect(result.type).toEqual([ChallengeType.TOB]);
    expect(result.mode).toEqual([ChallengeMode.TOB_REGULAR]);
  });
});
