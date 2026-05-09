import { ChallengeMode, ChallengeType, Stage } from '@blert/common';

import { ClientEvents } from './client-events';
import { MergeMapping } from './tick-mapping';
import { MergeTracer } from './trace';

export type RegisteredClient = {
  client: ClientEvents;
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
