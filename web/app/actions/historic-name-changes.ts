import { randomUUID } from 'crypto';

import { NameChangeKind, NameChangeStatus } from '@blert/common';

import { sql } from './db';
import processor, {
  type ChainError,
  type ChainTransition,
  validateChain,
} from './name-change-processor';

export {
  type ChainTransition,
  type DryRunResult,
  dryRunHistoricNameChange,
} from './name-change-processor';

export type SubmitHistoricResult =
  | { ok: true; sequenceId: string }
  | { ok: false; error: ChainError };

/**
 * Records a historic name change chain as a pending sequence to be processed.
 * @returns The sequence's ID, or a validation error if the chain is malformed.
 */
export async function submitHistoricNameChange(
  chain: ChainTransition[],
): Promise<SubmitHistoricResult> {
  const error = validateChain(chain);
  if (error !== null) {
    return { ok: false, error };
  }

  const sequenceId = randomUUID();
  const submittedAt = new Date();
  const rows = chain.map((transition, i) => ({
    player_id: null,
    old_name: transition.oldName,
    new_name: transition.newName,
    status: NameChangeStatus.PENDING,
    submitted_at: submittedAt,
    effective_from: transition.effectiveFrom,
    effective_to: i + 1 < chain.length ? chain[i + 1].effectiveFrom : null,
    kind: NameChangeKind.HISTORIC,
    sequence_id: sequenceId,
  }));

  await sql`INSERT INTO name_changes ${sql(rows)}`;
  processor.start();

  return { ok: true, sequenceId };
}
