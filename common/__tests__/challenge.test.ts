import {
  ChallengeType,
  isColosseumStage,
  isCoxStage,
  isInfernoStage,
  isMokhaiotlStage,
  isToaStage,
  isTobStage,
  Stage,
  stagesForChallenge,
} from '../challenge';

describe('Stage classification', () => {
  const allStages = Object.values(Stage).filter(
    (stage) => stage !== Stage.UNKNOWN,
  ) as Stage[];

  it('classifies colosseum stages correctly', () => {
    const colosseumStages = new Set(
      stagesForChallenge(ChallengeType.COLOSSEUM),
    );
    for (const stage of allStages) {
      if (isColosseumStage(stage)) {
        expect(colosseumStages.has(stage)).toBe(true);
      } else {
        expect(colosseumStages.has(stage)).toBe(false);
      }
    }
  });

  it('classifies cox stages correctly', () => {
    const coxStages = new Set(stagesForChallenge(ChallengeType.COX));
    for (const stage of allStages) {
      if (isCoxStage(stage)) {
        expect(coxStages.has(stage)).toBe(true);
      } else {
        expect(coxStages.has(stage)).toBe(false);
      }
    }
  });

  it('classifies inferno stages correctly', () => {
    const infernoStages = new Set(stagesForChallenge(ChallengeType.INFERNO));
    for (const stage of allStages) {
      if (isInfernoStage(stage)) {
        expect(infernoStages.has(stage)).toBe(true);
      } else {
        expect(infernoStages.has(stage)).toBe(false);
      }
    }
  });

  it('classifies mokhaiotl stages correctly', () => {
    const mokhaiotlStages = new Set(
      stagesForChallenge(ChallengeType.MOKHAIOTL),
    );
    for (const stage of allStages) {
      if (isMokhaiotlStage(stage)) {
        expect(mokhaiotlStages.has(stage)).toBe(true);
      } else {
        expect(mokhaiotlStages.has(stage)).toBe(false);
      }
    }
  });

  it('classifies toa stages correctly', () => {
    const toaStages = new Set(stagesForChallenge(ChallengeType.TOA));
    for (const stage of allStages) {
      if (isToaStage(stage)) {
        expect(toaStages.has(stage)).toBe(true);
      } else {
        expect(toaStages.has(stage)).toBe(false);
      }
    }
  });

  it('classifies tob stages correctly', () => {
    const tobStages = new Set(stagesForChallenge(ChallengeType.TOB));
    for (const stage of allStages) {
      if (isTobStage(stage)) {
        expect(tobStages.has(stage)).toBe(true);
      } else {
        expect(tobStages.has(stage)).toBe(false);
      }
    }
  });
});
