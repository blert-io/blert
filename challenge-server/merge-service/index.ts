import { MergePool, MergePoolOptions } from './pool';
import { MergeService, MergeServiceConfig } from './service';

export type { MergePoolOptions } from './pool';
export { CaptureReason } from './policy';
export {
  type CaptureFilters,
  type CaptureIndexEntry,
  MergeService,
  type MergeServiceConfig,
  parseUnmergedEventsFile,
  unmergedEventsFile,
  type UnmergedEventsFileInfo,
} from './service';

export { type UnmergedEventData } from './types';

/**
 * Builds a `MergeService` backed by a worker pool.
 * @param options Optional pool configuration.
 * @returns The service.
 */
export function mergeServiceWithWorkerPool(
  options?: MergePoolOptions,
  config: MergeServiceConfig = {},
): MergeService {
  return new MergeService(new MergePool(options), config);
}
