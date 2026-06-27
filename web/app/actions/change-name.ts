'use server';

import {
  CamelToSnakeCase,
  NameChange,
  NameChangeStatus,
  isValidRsn,
  normalizeRsn,
} from '@blert/common';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { sql } from './db';
import processor from './name-change-processor';
import { getSignedInUserId } from './users';

type NameChangeRow = CamelToSnakeCase<NameChange> & {
  player_id: number;
  submitter_id: string | null;
  hidden_from_feed: boolean;
  hidden_from_profile: boolean;
};

export async function submitNameChangeForm(
  _state: string | null,
  formData: FormData,
): Promise<string | null> {
  const oldName = formData.get('blert-old-name') as string;
  const newName = formData.get('blert-new-name') as string;

  if (!isValidRsn(oldName)) {
    return 'Invalid old name';
  }
  if (!isValidRsn(newName)) {
    return 'Invalid new name';
  }

  const userId = await getSignedInUserId();

  const [player] = await sql<[{ id: number; username: string }?]>`
    SELECT id, username
    FROM players
    WHERE normalized_username = ${normalizeRsn(oldName)}
  `;

  if (!player) {
    return `No Blert player found with the name ${oldName}`;
  }

  const [existingPending] = await sql`
    SELECT 1 FROM name_changes
    WHERE player_id = ${player.id}
      AND status IN (${NameChangeStatus.PENDING}, ${NameChangeStatus.DEFERRED})
    LIMIT 1
  `;
  if (existingPending) {
    return 'This player already has a pending name change';
  }

  const now = new Date();
  const nameChange: Partial<NameChangeRow> = {
    status: NameChangeStatus.PENDING,
    old_name: player.username,
    new_name: newName,
    player_id: player.id,
    submitted_at: now,
    effective_from: now,
  };
  if (userId !== null) {
    nameChange.submitter_id = userId.toString();
  }

  await sql`INSERT INTO name_changes ${sql(nameChange)}`;
  processor.start();

  revalidatePath('/name-changes');
  redirect('/name-changes');
}

function rowToNameChange(nc: NameChangeRow): NameChange {
  return {
    id: nc.id,
    oldName: nc.old_name,
    newName: nc.new_name,
    status: nc.status,
    submittedAt: nc.submitted_at,
    processedAt: nc.processed_at,
    kind: nc.kind,
    effectiveFrom: nc.effective_from,
    effectiveTo: nc.effective_to,
    sequenceId: nc.sequence_id,
  };
}

export async function getRecentNameChanges(
  limit: number = 10,
): Promise<NameChange[]> {
  const nameChanges = await sql<NameChangeRow[]>`
    SELECT
      id,
      old_name,
      new_name,
      status,
      submitted_at,
      processed_at,
      kind,
      effective_from,
      effective_to,
      sequence_id
    FROM name_changes
    WHERE hidden_from_feed = FALSE
    ORDER BY effective_from DESC
    LIMIT ${limit}
  `;

  return nameChanges.map(rowToNameChange);
}

export async function getNameChangesForPlayer(
  username: string,
  limit: number = 10,
): Promise<NameChange[]> {
  const nameChanges = await sql<NameChangeRow[]>`
    SELECT
      nc.id,
      nc.old_name,
      nc.new_name,
      nc.status,
      nc.submitted_at,
      nc.processed_at,
      nc.kind,
      nc.effective_from,
      nc.effective_to,
      nc.sequence_id
    FROM name_changes nc
    JOIN players p ON nc.player_id = p.id
    WHERE p.normalized_username = ${normalizeRsn(username)}
      AND nc.status = ${NameChangeStatus.ACCEPTED}
      AND nc.hidden_from_profile = FALSE
    ORDER BY nc.effective_from DESC
    LIMIT ${limit}
  `;

  return nameChanges.map(rowToNameChange);
}
