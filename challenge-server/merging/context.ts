import { ChallengeMode, ChallengeType, Stage } from '@blert/common';

import { ClientEvents } from './client-events';
import { MergeMapping } from './tick-mapping';
import { MergeTracer } from './trace';

export const enum MergeClientStatus {
  /** The client was successfully merged into the merged events. */
  MERGED = 'MERGED',

  /** The client could not be merged into the merged events. */
  UNMERGED = 'UNMERGED',

  /** The client was skipped due to critical anomalies or other issues. */
  SKIPPED = 'SKIPPED',
}

export type RegisteredClient = {
  client: ClientEvents;
  status: MergeClientStatus;
};

export type ChallengeInfo = {
  uuid: string;
  type: ChallengeType;
  mode: ChallengeMode;
  party: string[];
};

export type MergeContext = {
  challenge: ChallengeInfo;
  stage: Stage;
  clients: Map<number, RegisteredClient>;
  mapping: MergeMapping;
  tracer: MergeTracer | undefined;
};
