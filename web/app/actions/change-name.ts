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

import { clamp } from '@/utils/math';

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

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export type NameChangeFeedPage = {
  changes: NameChange[];
  /** Opaque keyset cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
  /**
   * Total rows matching the filter, computed only for the first page; 0 on
   * subsequent ones.
   */
  total: number;
};

/**
 * Fetches a page of feed name changes, newest first, ordered by processing time
 * (falling back to submission time for unprocessed changes).
 *
 * If `query` is nonempty, results are filtered to a case-insensitive substring
 * match on either the old or new name.
 *
 * @param cursor Cursor from a previous page, or null to start from the newest.
 * @param pageSize Rows to return, clamped to [1, 100].
 * @param query Optional search string.
 */
export async function getNameChanges(
  cursor: string | null,
  pageSize: number = DEFAULT_PAGE_SIZE,
  query: string = '',
): Promise<NameChangeFeedPage> {
  const trimmed = query.trim().slice(0, 24);
  const hasQuery = trimmed.length > 0;
  const escaped = trimmed.replace(/[\\%_]/g, (c) => `\\${c}`);
  const searchClause = hasQuery
    ? sql`AND (old_name ILIKE ${`%${escaped}%`} OR new_name ILIKE ${`%${escaped}%`})`
    : sql``;

  pageSize = Number.isFinite(pageSize)
    ? clamp(Math.trunc(pageSize), 1, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  let cursorAt: Date | null = null;
  let cursorId = 0;
  if (cursor !== null) {
    const separator = cursor.indexOf('_');
    const ts = Number(cursor.slice(0, separator));
    const id = Number(cursor.slice(separator + 1));
    if (separator !== -1 && Number.isFinite(ts) && Number.isFinite(id)) {
      cursorAt = new Date(ts);
      cursorId = id;
    }
  }

  const [rows, total] = await Promise.all([
    sql<(NameChangeRow & { sort_at: Date })[]>`
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
        sequence_id,
        COALESCE(processed_at, submitted_at) AS sort_at
      FROM name_changes
      WHERE hidden_from_feed = FALSE
        ${searchClause}
        ${
          cursorAt !== null
            ? sql`AND (
                COALESCE(processed_at, submitted_at) < ${cursorAt}
                OR (COALESCE(processed_at, submitted_at) = ${cursorAt} AND id < ${cursorId})
              )`
            : sql``
        }
      ORDER BY COALESCE(processed_at, submitted_at) DESC, id DESC
      LIMIT ${pageSize + 1}
    `,
    cursor === null
      ? sql<[{ total: number }]>`
          SELECT COUNT(*)::int AS total
          FROM name_changes
          WHERE hidden_from_feed = FALSE
            ${searchClause}
        `.then(([row]) => row.total)
      : Promise.resolve(0),
  ]);

  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;

  let nextCursor: string | null = null;
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1];
    nextCursor = `${last.sort_at.getTime()}_${last.id}`;
  }

  return { changes: page.map(rowToNameChange), nextCursor, total };
}

/**
 * Fetches a player's accepted name changes, newest first.
 *
 * @param username The player to look up.
 * @param limit Maximum rows to return, or null for the full history.
 */
export async function getNameChangesForPlayer(
  username: string,
  limit: number | null = 10,
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
    ${limit !== null ? sql`LIMIT ${limit}` : sql``}
  `;

  return nameChanges.map(rowToNameChange);
}
