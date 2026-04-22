import { Stage } from '@blert/common';

import { ClientEvents } from './client-events';
import { MergeMapping } from './tick-mapping';
import { MergeTracer } from './trace';

export type RegisteredClient = {
  client: ClientEvents;
};

export type MergeContext = {
  stage: Stage;
  clients: Map<number, RegisteredClient>;
  mapping: MergeMapping;
  tracer: MergeTracer | undefined;
};
