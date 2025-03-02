'use server';

import { NameChange, NameChangeStatus } from '@blert/common';
import processor from './name-change-processor';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { sql } from './db';

const RSN_REGEX = /^[a-zA-Z0-9 _-]{1,12}$/;

export async function submitNameChangeForm(
  _state: string | null,
  formData: FormData,
): Promise<string | null> {
  const oldName = formData.get('blert-old-name') as string;
  const newName = formData.get('blert-new-name') as string;

  if (!RSN_REGEX.test(oldName)) {
    return 'Invalid old name';
  }
  if (!RSN_REGEX.test(newName)) {
    return 'Invalid new name';
  }

  const session = await auth();

  const [player] = await sql`
    SELECT id, username
    FROM players
    WHERE lower(username) = ${oldName.toLowerCase()}
  `;

  if (!player) {
    return `No Blert player found with the name ${oldName}`;
  }

  const nameChange: Record<string, any> = {
    status: NameChangeStatus.PENDING,
    old_name: player.username,
    new_name: newName,
    player_id: player.id,
    submitted_at: new Date(),
  };
  if (session !== null && session.user.id !== undefined) {
    nameChange.submitter_id = session.user.id;
  }

  await sql`INSERT INTO name_changes ${sql(nameChange)}`;
  processor.start();

  redirect('/name-changes');
}

export async function getRecentNameChanges(
  limit: number = 10,
): Promise<NameChange[]> {
  const nameChanges = await sql`
    SELECT
      id,
      old_name,
      new_name,
      status,
      submitted_at,
      processed_at
    FROM name_changes
    WHERE hidden = FALSE
    ORDER BY id DESC
    LIMIT ${limit}
  `;

  return nameChanges.map((nc) => ({
    id: nc.id,
    oldName: nc.old_name,
    newName: nc.new_name,
    status: nc.status,
    submittedAt: nc.submitted_at,
    processedAt: nc.processed_at,
  }));
}

export async function getNameChangesForPlayer(
  username: string,
  limit: number = 10,
): Promise<NameChange[]> {
  const nameChanges = await sql`
    SELECT
      nc.id,
      nc.old_name,
      nc.new_name,
      nc.status,
      nc.submitted_at,
      nc.processed_at
    FROM name_changes nc
    JOIN players p ON nc.player_id = p.id
    WHERE lower(p.username) = ${username.toLowerCase()}
      AND nc.status = ${NameChangeStatus.ACCEPTED}
      AND nc.hidden = FALSE
    ORDER BY nc.processed_at DESC
    LIMIT ${limit}
  `;

  return nameChanges.map((nc) => ({
    id: nc.id,
    oldName: nc.old_name,
    newName: nc.new_name,
    status: nc.status,
    submittedAt: nc.submitted_at,
    processedAt: nc.processed_at,
  }));
}
