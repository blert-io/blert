import { Stage } from '@blert/common';

/**
 * Kind of an effect event.
 * Matches `EventKind` in `//challenge-harder/src/processing/effects.rs`.
 */
export enum EffectEventKind {
  CHALLENGE_FINISHED = 0,
  STAGE_FINISHED = 1,
}

/** Subject of a `CHALLENGE_FINISHED` event. */
export type ChallengeSubject = {
  uuid: string;
};

/** Subject of a `STAGE_FINISHED` event. */
export type StageSubject = {
  uuid: string;
  stage: Stage;
  attempt: number | null;
};

export type EffectSubject = {
  [EffectEventKind.CHALLENGE_FINISHED]: ChallengeSubject;
  [EffectEventKind.STAGE_FINISHED]: StageSubject;
};
