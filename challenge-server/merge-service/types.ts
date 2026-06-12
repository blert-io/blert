import { ClientStageStream, Stage } from '@blert/common';

import { ChallengeInfo, MergeClient, MergeResult } from '../merging';

/** A unit of merge work dispatched to a pool worker. */
export type MergeJob = {
  challengeInfo: ChallengeInfo;
  stage: Stage;
  attempt: number | null;
  /** The raw, flat stage stream for all clients. */
  stream: ClientStageStream[];
};

export type MergeResultMetadata = Omit<MergeResult, 'events'>;

/**
 * The outcome of a merge job. If successful, contains the merge result with its
 * events separately serialized.
 */
export type MergeReply =
  | { kind: 'merged'; events: string; result: MergeResultMetadata }
  | { kind: 'bad_data' }
  | { kind: 'exception' };

/** A long-running merge job executor. */
export interface MergeRunner {
  run(job: MergeJob): Promise<MergeReply>;
  destroy(): Promise<void>;
}

export type UnmergedEventData = {
  challengeInfo: ChallengeInfo;
  stage: Stage;
  attempt?: number | null;
  /** Why this stage's streams were captured. Absent in legacy captures. */
  captureReasons?: string[];
  mergedClients: MergeClient[];
  unmergedClients: MergeClient[];
  rawEvents: ClientStageStream[];
};
