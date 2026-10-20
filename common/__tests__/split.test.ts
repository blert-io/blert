import { Stage } from '../challenge';
import { SplitType, splitToStage } from '../split';

describe('splitToStage', () => {
  it('maps tfa splits to their stages', () => {
    const expected: [SplitType, Stage][] = [
      [SplitType.TFA_CHALLENGE, Stage.UNKNOWN],
      [SplitType.TFA_OVERALL, Stage.UNKNOWN],
      [SplitType.TFA_GUARDIAN, Stage.TFA_GUARDIAN],
      [SplitType.TFA_EZEKIEL, Stage.TFA_EZEKIEL],
      [SplitType.TFA_BORK, Stage.TFA_BORK],
      [SplitType.TFA_NECROMANCER, Stage.TFA_NECROMANCER],
      [SplitType.TFA_DREADNOTH, Stage.TFA_DREADNOTH],
      [SplitType.TFA_XARTH, Stage.TFA_XARTH],
      [SplitType.TFA_DAGONHAI, Stage.TFA_DAGONHAI],
      [SplitType.TFA_FINAL, Stage.TFA_FINAL],
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
