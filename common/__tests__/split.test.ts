import { Stage } from '../challenge';
import { SplitType, splitToStage } from '../split';

describe('splitToStage', () => {
  it('maps tob splits to their stages', () => {
    const expected: [SplitType, Stage][] = [
      [SplitType.TOB_CHALLENGE, Stage.UNKNOWN],
      [SplitType.TOB_OVERALL, Stage.UNKNOWN],
      [SplitType.TOB_MAIDEN, Stage.TOB_MAIDEN],
      [SplitType.TOB_MAIDEN_70S, Stage.TOB_MAIDEN],
      [SplitType.TOB_MAIDEN_50S, Stage.TOB_MAIDEN],
      [SplitType.TOB_MAIDEN_30S, Stage.TOB_MAIDEN],
      [SplitType.TOB_MAIDEN_70S_50S, Stage.TOB_MAIDEN],
      [SplitType.TOB_MAIDEN_50S_30S, Stage.TOB_MAIDEN],
      [SplitType.TOB_MAIDEN_30S_END, Stage.TOB_MAIDEN],
      [SplitType.TOB_BLOAT, Stage.TOB_BLOAT],
      [SplitType.TOB_NYLO_ROOM, Stage.TOB_NYLOCAS],
      [SplitType.TOB_NYLO_CAP, Stage.TOB_NYLOCAS],
      [SplitType.TOB_NYLO_WAVES, Stage.TOB_NYLOCAS],
      [SplitType.TOB_NYLO_CLEANUP, Stage.TOB_NYLOCAS],
      [SplitType.TOB_NYLO_BOSS_SPAWN, Stage.TOB_NYLOCAS],
      [SplitType.TOB_NYLO_BOSS, Stage.TOB_NYLOCAS],
      [SplitType.TOB_SOTETSEG, Stage.TOB_SOTETSEG],
      [SplitType.TOB_SOTETSEG_66, Stage.TOB_SOTETSEG],
      [SplitType.TOB_SOTETSEG_33, Stage.TOB_SOTETSEG],
      [SplitType.TOB_SOTETSEG_MAZE_1, Stage.TOB_SOTETSEG],
      [SplitType.TOB_SOTETSEG_MAZE_2, Stage.TOB_SOTETSEG],
      [SplitType.TOB_SOTETSEG_P2, Stage.TOB_SOTETSEG],
      [SplitType.TOB_SOTETSEG_P3, Stage.TOB_SOTETSEG],
      [SplitType.TOB_XARPUS, Stage.TOB_XARPUS],
      [SplitType.TOB_XARPUS_EXHUMES, Stage.TOB_XARPUS],
      [SplitType.TOB_XARPUS_SCREECH, Stage.TOB_XARPUS],
      [SplitType.TOB_XARPUS_P2, Stage.TOB_XARPUS],
      [SplitType.TOB_XARPUS_P3, Stage.TOB_XARPUS],
      [SplitType.TOB_VERZIK_ROOM, Stage.TOB_VERZIK],
      [SplitType.TOB_VERZIK_P1_END, Stage.TOB_VERZIK],
      [SplitType.TOB_VERZIK_REDS_PUSH, Stage.TOB_VERZIK],
      [SplitType.TOB_VERZIK_REDS, Stage.TOB_VERZIK],
      [SplitType.TOB_VERZIK_P2_END, Stage.TOB_VERZIK],
      [SplitType.TOB_VERZIK_P2, Stage.TOB_VERZIK],
      [SplitType.TOB_VERZIK_P3, Stage.TOB_VERZIK],
      [SplitType.TOB_NYLO_START, Stage.UNKNOWN],
      [SplitType.TOB_SOTETSEG_START, Stage.UNKNOWN],
      [SplitType.TOB_XARPUS_START, Stage.UNKNOWN],
      [SplitType.TOB_VERZIK_START, Stage.UNKNOWN],
      [SplitType.TOB_REG_VERZIK_REDS_PUSH, Stage.TOB_VERZIK],
      [SplitType.TOB_HM_VERZIK_REDS_PUSH, Stage.TOB_VERZIK],
    ];
    expect(expected.map(([split]) => [split, splitToStage(split)])).toEqual(
      expected,
    );
  });

  it('maps tfa splits to their stages', () => {
    const expected: [SplitType, Stage][] = [
      [SplitType.TFA_CHALLENGE, Stage.UNKNOWN],
      [SplitType.TFA_OVERALL, Stage.UNKNOWN],
      [SplitType.TFA_GUARDIAN, Stage.TFA_GUARDIAN],
      [SplitType.TFA_EZEKIEL, Stage.TFA_EZEKIEL],
      [SplitType.TFA_BORK, Stage.TFA_BORK],
      [SplitType.TFA_MOIA, Stage.TFA_MOIA],
      [SplitType.TFA_DREADNOTH, Stage.TFA_DREADNOTH],
      [SplitType.TFA_DAGONHAI, Stage.TFA_DAGONHAI],
      [SplitType.TFA_XARTH, Stage.TFA_XARTH],
      [SplitType.TFA_OCELLUS, Stage.TFA_OCELLUS],
      [SplitType.TFA_ROW_1_START, Stage.TFA_GUARDIAN],
      [SplitType.TFA_ROW_2_START, Stage.UNKNOWN],
      [SplitType.TFA_ROW_3_START, Stage.UNKNOWN],
      [SplitType.TFA_FINAL_START, Stage.UNKNOWN],
    ];
    expect(expected.map(([split]) => [split, splitToStage(split)])).toEqual(
      expected,
    );
  });
});
