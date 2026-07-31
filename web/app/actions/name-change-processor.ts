import {
  activePlayerKey,
  CamelToSnakeCase,
  HiscoresRateLimitError,
  NAME_CHANGE_PUBSUB_KEY,
  NameChangeKind,
  NameChangeStatus,
  NameChangeUpdate,
  NameChangeUpdateType,
  PlayerExperience,
  PlayerStats,
  Skill,
  hiscoreLookup,
  isValidRsn,
  normalizeRsn,
} from '@blert/common';

import logger from '@/utils/log';

import { sql, type Db } from './db';
import redis from './redis';

async function publishNameChangeUpdate(
  update: NameChangeUpdate,
): Promise<void> {
  const client = await redis();
  await client.publish(NAME_CHANGE_PUBSUB_KEY, JSON.stringify(update));
}

/**
 * Checks if a player is currently in an active challenge by looking up their
 * active player key in Redis.
 *
 * @param oldName The player's old (current) username.
 * @param newName The player's new username.
 * @returns True if the player is in an active challenge under either name.
 */
async function isPlayerInActiveChallenge(
  oldName: string,
  newName: string,
): Promise<boolean> {
  const client = await redis();
  const results = await client
    .multi()
    .get(activePlayerKey(oldName))
    .get(activePlayerKey(newName))
    .exec();
  return results.some((result) => result !== null);
}

type PlayerStatsRow = CamelToSnakeCase<PlayerStats> & {
  id: number;
};

async function lastStatsAtOrBefore(
  playerId: number,
  date: Date | null,
  db: Db,
): Promise<PlayerStatsRow | undefined> {
  // A null date means the window starts at the beginning of time, so there is
  // no prior row to use as a baseline.
  if (date === null) {
    return undefined;
  }
  const [row] = await db<[PlayerStatsRow?]>`
    SELECT *
    FROM player_stats
    WHERE player_id = ${playerId}
    AND date <= ${date}
    ORDER BY date DESC
    LIMIT 1
  `;
  return row;
}

export async function updatePlayerStats(
  targetPlayerId: number,
  sourcePlayerId: number,
  fromDate: Date | null,
  toDate: Date | null = null,
  db: Db = sql,
): Promise<number> {
  const targetPlayerLastStats = await lastStatsAtOrBefore(
    targetPlayerId,
    fromDate,
    db,
  );
  const sourcePlayerLastStats = await lastStatsAtOrBefore(
    sourcePlayerId,
    fromDate,
    db,
  );

  const statsToMigrate = await db<PlayerStatsRow[]>`
    SELECT *
    FROM player_stats
    WHERE player_id = ${sourcePlayerId}
    ${fromDate !== null ? sql`AND date > ${fromDate}` : sql``}
    ${toDate !== null ? sql`AND date <= ${toDate}` : sql``}
    ORDER BY date ASC
  `;

  // Reassign the new player's stats to the old player, adjusting the values by
  // the difference accumulated since the fromDate.
  let lastInWindowDeltas: Record<string, number> = {};
  for (const stats of statsToMigrate) {
    const newStats: Record<string, number> = {
      player_id: targetPlayerId,
    };
    const deltas: Record<string, number> = {};

    Object.entries(stats).forEach(([key, value]) => {
      if (key === 'id' || key === 'player_id' || typeof value !== 'number') {
        return;
      }
      const k = key as keyof PlayerStatsRow;
      const base = (sourcePlayerLastStats?.[k] as number | undefined) ?? 0;
      const delta = value - base;
      deltas[key] = delta;
      const old = (targetPlayerLastStats?.[k] as number | undefined) ?? 0;
      newStats[key] = old + delta;
    });

    lastInWindowDeltas = deltas;

    await db`
      UPDATE player_stats SET ${sql(newStats)} WHERE id = ${stats.id}
    `;
  }

  // Per-player activity counters need symmetric adjustment for any rows that
  // exist after `toDate`:
  //
  // - source player's post-window rows still include the in-window contribution
  //   they recorded at the time: subtract the window delta.
  // - target player's post-window rows never saw the in-window activity (it was
  //   credited to the source): add the window delta.
  //
  if (toDate !== null && statsToMigrate.length > 0) {
    const nonZero = Object.entries(lastInWindowDeltas).filter(
      ([, v]) => v !== 0,
    );
    if (nonZero.length > 0) {
      const [firstCol, firstDelta] = nonZero[0];

      let tgtClause = sql`${sql(firstCol)} = ${sql(firstCol)} + ${firstDelta}`;
      let srcClause = sql`${sql(firstCol)} = ${sql(firstCol)} - ${firstDelta}`;

      for (let i = 1; i < nonZero.length; i++) {
        const [col, delta] = nonZero[i];
        tgtClause = sql`${tgtClause}, ${sql(col)} = ${sql(col)} + ${delta}`;
        srcClause = sql`${srcClause}, ${sql(col)} = ${sql(col)} - ${delta}`;
      }
      await Promise.all([
        db`
          UPDATE player_stats SET ${tgtClause}
          WHERE player_id = ${targetPlayerId} AND date > ${toDate}
        `,
        db`
          UPDATE player_stats SET ${srcClause}
          WHERE player_id = ${sourcePlayerId} AND date > ${toDate}
        `,
      ]);
    }
  }

  return statsToMigrate.length;
}

/**
 * Reassigns API keys whose `last_used` falls within a migration window from
 * source to target. Keys outside the window are left in place.
 *
 * @param targetPlayerId ID of the target player.
 * @param sourcePlayerId ID of the source player.
 * @param fromDate Start date of the migration window, or null for unbounded.
 * @param toDate Optional end date of the migration window.
 * @param db The database connection.
 * @returns The number of API keys reassigned.
 */
export async function updateApiKeys(
  targetPlayerId: number,
  sourcePlayerId: number,
  fromDate: Date | null,
  toDate: Date | null = null,
  db: Db = sql,
): Promise<number> {
  const updated = await db`
    UPDATE api_keys
    SET player_id = ${targetPlayerId}
    WHERE player_id = ${sourcePlayerId}
      ${fromDate !== null ? sql`AND last_used > ${fromDate}` : sql``}
      ${toDate !== null ? sql`AND last_used <= ${toDate}` : sql``}
  `;
  return updated.count;
}

type SplitRow = {
  id: number;
  type: number;
  scale: number;
  ticks: number;
  finish_time: Date;
};

/** Returns the distinct accurate splits recorded in a set of challenges. */
async function distinctAccurateSplitTypes(
  challengeIds: number[],
  db: Db,
): Promise<[number, number][]> {
  if (challengeIds.length === 0) {
    return [];
  }
  const rows = await db<{ type: number; scale: number }[]>`
    SELECT DISTINCT type, scale
    FROM challenge_splits
    WHERE challenge_id = ANY(${challengeIds}) AND accurate
  `;
  return rows.map((r) => [r.type, r.scale]);
}

export async function updatePersonalBestHistory(
  targetPlayerId: number,
  sourcePlayerId: number,
  challengeIds: number[],
  db: Db = sql,
): Promise<number> {
  if (challengeIds.length === 0) {
    return 0;
  }

  // Find all splits from the challenges that are being migrated from the source
  // player to the target player.
  const sourcePlayerSplits = await db<SplitRow[]>`
    SELECT
      cs.id,
      cs.type,
      cs.scale,
      cs.ticks,
      c.finish_time
    FROM challenge_splits cs
    JOIN challenges c ON cs.challenge_id = c.id
    WHERE cs.challenge_id = ANY(${challengeIds}) AND cs.accurate
    ORDER BY c.finish_time ASC
  `;

  if (sourcePlayerSplits.length === 0) {
    return 0;
  }

  const distinctSplitTypes: [number, number][] = sourcePlayerSplits
    .filter(
      (split: SplitRow, index: number, self: SplitRow[]) =>
        index ===
        self.findIndex(
          (s: SplitRow) => s.type === split.type && s.scale === split.scale,
        ),
    )
    .map((split: SplitRow) => [split.type, split.scale]);

  // Recompute the PB history for both players to account for the moved
  // challenges, starting from the first migrated challenge.
  const cutoffChallengeId = Math.min(...challengeIds);
  let recomputedCount = 0;

  recomputedCount += await recomputePbHistoryFrom(
    sourcePlayerId,
    distinctSplitTypes,
    cutoffChallengeId,
    db,
  );
  recomputedCount += await recomputePbHistoryFrom(
    targetPlayerId,
    distinctSplitTypes,
    cutoffChallengeId,
    db,
  );

  return recomputedCount;
}

/**
 * Rebuilds a player's PB history for a set of splits and scales over challenges
 * with an `id` starting at `cutoffChallengeId`.
 *
 * @param playerId ID of the player.
 * @param splitsToRecompute Array of split (type, scale) pairs to recompute.
 * @param cutoffChallengeId First challenge ID to recompute.
 * @param db The database connection.
 * @returns Number of PB history rows affected.
 */
export async function recomputePbHistoryFrom(
  playerId: number,
  splitsToRecompute: [number, number][],
  cutoffChallengeId: number,
  db: Db = sql,
): Promise<number> {
  if (splitsToRecompute.length === 0) {
    return 0;
  }

  const splitFragments = splitsToRecompute.map(([t, s]) => sql([t, s]));

  const deleted = await db`
    DELETE FROM personal_best_history pbh
    USING challenge_splits cs
    WHERE pbh.challenge_split_id = cs.id
      AND pbh.player_id = ${playerId}
      AND cs.challenge_id >= ${cutoffChallengeId}
      AND (cs.type, cs.scale) IN ${sql(splitFragments)}
  `;

  const bestRows = await db<
    { type: number; scale: number; best: number | null }[]
  >`
    SELECT cs.type, cs.scale, MIN(cs.ticks) AS best
    FROM challenge_splits cs
    JOIN challenge_players cp ON cp.challenge_id = cs.challenge_id
    WHERE cp.player_id = ${playerId}
      AND (cs.type, cs.scale) IN ${sql(splitFragments)}
      AND cs.accurate
      AND cs.challenge_id < ${cutoffChallengeId}
    GROUP BY cs.type, cs.scale
  `;

  const splitKey = (type: number, scale: number) => `${type}-${scale}`;
  const bestMap: Record<string, number> = {};
  for (const r of bestRows) {
    if (r.best !== null) {
      bestMap[splitKey(r.type, r.scale)] = r.best;
    }
  }

  const splits = await db<SplitRow[]>`
    SELECT cs.id, cs.type, cs.scale, cs.ticks, c.finish_time
    FROM challenge_splits cs
    JOIN challenges c ON cs.challenge_id = c.id
    JOIN challenge_players cp ON cp.challenge_id = c.id
    WHERE cp.player_id = ${playerId}
      AND (cs.type, cs.scale) IN ${sql(splitFragments)}
      AND cs.accurate
      AND cs.challenge_id >= ${cutoffChallengeId}
    ORDER BY c.finish_time ASC
  `;

  const pbsToInsert: {
    player_id: number;
    challenge_split_id: number;
    created_at: Date;
  }[] = [];

  for (const split of splits) {
    const k = splitKey(split.type, split.scale);
    const currentBest = bestMap[k];
    if (currentBest === undefined || split.ticks < currentBest) {
      pbsToInsert.push({
        player_id: playerId,
        challenge_split_id: split.id,
        created_at: split.finish_time,
      });
      bestMap[k] = split.ticks;
    }
  }

  let inserted = 0;
  if (pbsToInsert.length > 0) {
    const result = await db`
      INSERT INTO personal_best_history ${sql(
        pbsToInsert,
        'player_id',
        'challenge_split_id',
        'created_at',
      )}
    `;
    inserted = result.count;
  }

  return deleted.count + inserted;
}

/** A single rename in a player's known name history. */
export type ChainTransition = {
  oldName: string;
  newName: string;
  effectiveFrom: Date;
};

/** Why a submitted name change chain is not well-formed. */
export type ChainError =
  'empty' | 'invalid_rsn' | 'not_chronological' | 'inconsistent_link';

/**
 * Checks that a name change chain is well-formed: nonempty, every name valid,
 * transitions strictly ordered by `effectiveFrom`, and with each transition's
 * new name matching the next transition's old name.
 *
 * @returns The first problem found, or `null` if the chain is well-formed.
 */
export function validateChain(chain: ChainTransition[]): ChainError | null {
  if (chain.length === 0) {
    return 'empty';
  }

  for (const transition of chain) {
    if (!isValidRsn(transition.oldName) || !isValidRsn(transition.newName)) {
      return 'invalid_rsn';
    }
  }

  for (let i = 1; i < chain.length; i++) {
    if (chain[i].effectiveFrom <= chain[i - 1].effectiveFrom) {
      return 'not_chronological';
    }
    if (normalizeRsn(chain[i - 1].newName) !== normalizeRsn(chain[i].oldName)) {
      return 'inconsistent_link';
    }
  }

  return null;
}

/** A contiguous time interval during which a player held a single RSN. */
export type NameWindow = {
  normalizedRsn: string;
  from: Date | null;
  to: Date | null;
};

function inWindow(t: Date, w: NameWindow): boolean {
  const afterFrom = w.from === null || t > w.from;
  const beforeTo = w.to === null || t <= w.to;
  return afterFrom && beforeTo;
}

/**
 * Derives a player's RSN history windows from a chronological chain.
 *
 * Produces `chain.length + 1` windows to cover the open-ended periods before
 * the first name change and after the last name change.
 */
export function deriveNameWindows(chain: ChainTransition[]): NameWindow[] {
  if (chain.length === 0) {
    throw new Error('chain must be non-empty');
  }

  const windows: NameWindow[] = [
    {
      normalizedRsn: normalizeRsn(chain[0].oldName),
      from: null,
      to: chain[0].effectiveFrom,
    },
  ];
  for (let i = 0; i < chain.length; i++) {
    windows.push({
      normalizedRsn: normalizeRsn(chain[i].newName),
      from: chain[i].effectiveFrom,
      to: i + 1 < chain.length ? chain[i + 1].effectiveFrom : null,
    });
  }
  return windows;
}

/**
 * Returns the normalized name the player held at time `t`
 * from a list of windows.
 */
export function nameInWindowsAt(windows: NameWindow[], t: Date): string {
  const window = windows.find((w) => inWindow(t, w));
  // A well-formed chain spans all of time.
  return window!.normalizedRsn;
}

/** Checks whether a name belongs to the chain's player at a given time. */
export function belongsToChainTarget(
  windows: NameWindow[],
  normalizedRsn: string,
  startTime: Date,
): boolean {
  return nameInWindowsAt(windows, startTime) === normalizedRsn;
}

function chainFromHistoricSequence(
  rows: Pick<
    NameChangeQueryResult,
    'old_name' | 'new_name' | 'effective_from'
  >[],
): ChainTransition[] {
  return rows
    .toSorted((a, b) => a.effective_from.getTime() - b.effective_from.getTime())
    .map((r) => ({
      oldName: r.old_name,
      newName: r.new_name,
      effectiveFrom: r.effective_from,
    }));
}

type TargetPlayer =
  | { action: 'use'; playerId: number }
  | { action: 'create'; currentName: string };

/**
 * The player ID of a source record for a historic name change sequence, with
 * the challenges they participated in during a single name window.
 * `windowIndex` references the migration plan's `windows`.
 */
type SourcePlayer = {
  playerId: number;
  windowIndex: number;
  challengeIds: number[];
};

/**
 * Description of what a historic name change sequence would change.
 */
export type MigrationPlan = {
  target: TargetPlayer;
  windows: NameWindow[];
  sourcePlayers: SourcePlayer[];
  /**
   * Source records who are entirely absorbed by the target and can be deleted.
   */
  emptiedSourceIds: number[];
  /**
   * Challenges already on the target that predate the player's tenure under the
   * current name and so belong to a prior holder. Split off to a zombie record.
   */
  evictedTargetChallengeIds: number[];
  /** Number of API keys on the target belonging to a prior holder. */
  unownedApiKeyCount: number;
  /**
   * Accepted live name change rows this sequence duplicates, wherever they are
   * attributed. Should be reassigned to the target and hidden from the profile
   * in favor of the more accurate historic rows.
   */
  supersededLiveRows: SupersededLiveRow[];
};

/**
 * Read-only resolution of the target player in a historic name change sequence.
 */
async function resolveTarget(
  chain: ChainTransition[],
  db: Db = sql,
): Promise<TargetPlayer> {
  const currentName = chain[chain.length - 1].newName;

  const [existing]: [{ id: number }?] = await db`
    SELECT id FROM players WHERE normalized_username = ${normalizeRsn(currentName)}
  `;
  if (existing !== undefined) {
    return { action: 'use', playerId: existing.id };
  }

  return { action: 'create', currentName };
}

/**
 * Finds the `challenge_players` rows that belong to a historic sequence's
 * target, grouped by source record and name window, ignoring those already
 * attributed to the target.
 */
async function gatherSourcePlayers(
  windows: NameWindow[],
  target: TargetPlayer,
  db: Db = sql,
): Promise<SourcePlayer[]> {
  const targetPlayerId = target.action === 'use' ? target.playerId : null;
  const sources: SourcePlayer[] = [];

  for (let windowIndex = 0; windowIndex < windows.length; windowIndex++) {
    const window = windows[windowIndex];

    const matched = await db<{ player_id: number; challenge_id: number }[]>`
      SELECT cp.player_id, cp.challenge_id
      FROM challenge_players cp
      JOIN challenges c ON c.id = cp.challenge_id
      WHERE translate(lower(cp.username), ' -', '__') = ${window.normalizedRsn}
        ${window.from !== null ? db`AND c.start_time > ${window.from}` : db``}
        ${window.to !== null ? db`AND c.start_time <= ${window.to}` : db``}
        ${targetPlayerId !== null ? db`AND cp.player_id <> ${targetPlayerId}` : db``}
      ORDER BY cp.player_id, cp.challenge_id
    `;

    const byPlayer = new Map<number, number[]>();
    for (const { player_id, challenge_id } of matched) {
      const ids = byPlayer.get(player_id) ?? [];
      ids.push(challenge_id);
      byPlayer.set(player_id, ids);
    }

    for (const [playerId, challengeIds] of byPlayer) {
      sources.push({ playerId, windowIndex, challengeIds });
    }
  }

  return sources;
}

/**
 * Returns the IDs of source records in a migration that would lose all of
 * their `challenge_players` rows to the target.
 */
async function findEmptiedSources(
  sourcePlayers: SourcePlayer[],
  db: Db = sql,
): Promise<number[]> {
  const movedCountByPlayer = new Map<number, number>();
  for (const source of sourcePlayers) {
    const prior = movedCountByPlayer.get(source.playerId) ?? 0;
    movedCountByPlayer.set(source.playerId, prior + source.challengeIds.length);
  }

  const emptied: number[] = [];
  for (const [playerId, movedCount] of movedCountByPlayer) {
    const [{ count }] = await db<[{ count: string }]>`
      SELECT COUNT(*) FROM challenge_players WHERE player_id = ${playerId}
    `;
    if (parseInt(count) === movedCount) {
      emptied.push(playerId);
    }
  }

  return emptied;
}

/**
 * Finds challenges already on the target record that do not belong to the
 * chain's player.
 */
async function findTargetUnownedChallenges(
  windows: NameWindow[],
  target: TargetPlayer,
  db: Db = sql,
): Promise<number[]> {
  if (target.action !== 'use') {
    return [];
  }

  const rows = await db<
    { challenge_id: number; username: string; start_time: Date }[]
  >`
    SELECT cp.challenge_id, cp.username, c.start_time
    FROM challenge_players cp
    JOIN challenges c ON c.id = cp.challenge_id
    WHERE cp.player_id = ${target.playerId}
    ORDER BY cp.challenge_id
  `;

  return rows
    .filter(
      (r) =>
        !belongsToChainTarget(windows, normalizeRsn(r.username), r.start_time),
    )
    .map((r) => r.challenge_id);
}

/** Counts API keys on the target outside of the current player window. */
async function countTargetUnownedKeys(
  windows: NameWindow[],
  target: TargetPlayer,
  db: Db = sql,
): Promise<number> {
  if (target.action !== 'use') {
    return 0;
  }

  const currentWindow = windows[windows.length - 1];
  const rows = await db<{ last_used: Date | null }[]>`
    SELECT last_used FROM api_keys WHERE player_id = ${target.playerId}
  `;

  return rows.filter(
    (r) => r.last_used === null || !inWindow(r.last_used, currentWindow),
  ).length;
}

/**
 * Slack applied to a live rename's timestamp when matching it against a chain
 * transition, absorbing skew between different change detection methods.
 */
const LIVE_RENAME_MATCH_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * Checks if a name change chain contains an entry corresponding to a previously
 * recorded live name change.
 */
function chainIncludesLiveRename(
  chain: ChainTransition[],
  liveRename: Pick<
    NameChangeQueryResult,
    'old_name' | 'new_name' | 'effective_from'
  >,
): boolean {
  const oldN = normalizeRsn(liveRename.old_name);
  const newN = normalizeRsn(liveRename.new_name);
  for (let i = 0; i < chain.length; i++) {
    if (
      normalizeRsn(chain[i].oldName) !== oldN ||
      normalizeRsn(chain[i].newName) !== newN
    ) {
      continue;
    }
    const from = new Date(
      chain[i].effectiveFrom.getTime() - LIVE_RENAME_MATCH_SLACK_MS,
    );
    const to = i + 1 < chain.length ? chain[i + 1].effectiveFrom : null;

    const effectiveFrom = liveRename.effective_from;
    if (effectiveFrom > from && (to === null || effectiveFrom <= to)) {
      return true;
    }
  }
  return false;
}

/** A live name change row that a historic sequence duplicates. */
type SupersededLiveRow = { id: number; playerId: number };

/**
 * Finds accepted live name change rows that record a rename in the provided
 * historic name change chain, wherever they are attributed.
 */
async function findSupersededLiveRows(
  chain: ChainTransition[],
  db: Db = sql,
): Promise<SupersededLiveRow[]> {
  const chainNames = [
    ...new Set(
      chain.flatMap((t) => [normalizeRsn(t.oldName), normalizeRsn(t.newName)]),
    ),
  ];

  const rows = await db<
    {
      id: number;
      player_id: number;
      old_name: string;
      new_name: string;
      effective_from: Date;
    }[]
  >`
    SELECT id, player_id, old_name, new_name, effective_from
    FROM name_changes
    WHERE kind = ${NameChangeKind.STANDARD}
      AND status = ${NameChangeStatus.ACCEPTED}
      AND translate(lower(old_name), ' -', '__') = ANY(${chainNames})
      AND translate(lower(new_name), ' -', '__') = ANY(${chainNames})
  `;

  return rows
    .filter((r) => chainIncludesLiveRename(chain, r))
    .map((r) => ({ id: r.id, playerId: r.player_id }));
}

/** Computes the migration plan for a historic name change chain. Read-only. */
export async function decide(
  chain: ChainTransition[],
  db: Db = sql,
): Promise<MigrationPlan> {
  const windows = deriveNameWindows(chain);
  const target = await resolveTarget(chain, db);
  const sourcePlayers = await gatherSourcePlayers(windows, target, db);

  const [
    emptiedSourceIds,
    evictedTargetChallengeIds,
    unownedApiKeyCount,
    supersededLiveRows,
  ] = await Promise.all([
    findEmptiedSources(sourcePlayers, db),
    findTargetUnownedChallenges(windows, target, db),
    countTargetUnownedKeys(windows, target, db),
    findSupersededLiveRows(chain, db),
  ]);

  return {
    target,
    windows,
    sourcePlayers,
    emptiedSourceIds,
    evictedTargetChallengeIds,
    unownedApiKeyCount,
    supersededLiveRows,
  };
}

async function resolveOrCreateTargetId(
  target: TargetPlayer,
  db: Db,
): Promise<number> {
  if (target.action === 'use') {
    return target.playerId;
  }
  const [created]: [{ id: number }] = await db`
    INSERT INTO players (username, normalized_username)
    VALUES (${target.currentName}, ${normalizeRsn(target.currentName)})
    RETURNING id
  `;
  logger.info('historic_target_created', {
    playerId: created.id,
    name: target.currentName,
  });
  return created.id;
}

/**
 * Returns the username for a "zombie" record storing data belonging to player
 * `name` with unknown provenance.
 */
function zombieName(name: string): string {
  const ZOMBIE_PREFIX = '*'; // Invalid OSRS character.
  return `${ZOMBIE_PREFIX}${name}`;
}

class UnownedApiKeysError extends Error {
  public readonly count: number;

  constructor(count: number) {
    super(`Target holds ${count} API key(s) belonging to a prior holder`);
    this.count = count;
  }
}

/**
 * Splits the target's own challenges that belong to a prior holder of the
 * current name onto a zombie record, removing their stats and personal bests
 * from the consolidated player.
 * @returns The number of documents moved onto the zombie.
 * @throws UnownedApiKeyError if the target has a previous holder's API keys.
 */
async function evictTargetHistory(
  plan: MigrationPlan,
  targetId: number,
  db: Db,
): Promise<number> {
  if (plan.unownedApiKeyCount > 0) {
    throw new UnownedApiKeysError(plan.unownedApiKeyCount);
  }

  const evicted = plan.evictedTargetChallengeIds;
  if (evicted.length === 0) {
    return 0;
  }

  const currentName = plan.windows[plan.windows.length - 1].normalizedRsn;

  const [{ username }] = await db<[{ username: string }]>`
    SELECT username FROM players WHERE id = ${targetId}
  `;
  const zn = zombieName(username);

  // Move data onto the zombie record for this username.
  const [zombie] = await db<[{ id: number }]>`
    INSERT INTO players (username, normalized_username, total_recordings)
    VALUES (${zn}, ${normalizeRsn(zn)}, ${evicted.length})
    RETURNING id
  `;

  let moved = 0;

  const cp = await db`
    UPDATE challenge_players SET player_id = ${zombie.id}
    WHERE player_id = ${targetId} AND challenge_id = ANY(${evicted})
  `;
  moved += cp.count;

  for (const window of plan.windows) {
    if (window.normalizedRsn === currentName) {
      continue;
    }
    moved += await updatePlayerStats(
      zombie.id,
      targetId,
      window.from,
      window.to,
      db,
    );
  }

  // Rebuild personal bests for the evicted splits on both records.
  const splits = await distinctAccurateSplitTypes(evicted, db);
  const cutoff = Math.min(...evicted);
  moved += await recomputePbHistoryFrom(targetId, splits, cutoff, db);
  moved += await recomputePbHistoryFrom(zombie.id, splits, cutoff, db);

  await db`
    UPDATE players SET total_recordings = total_recordings - ${evicted.length}
    WHERE id = ${targetId}
  `;

  logger.info('historic_target_eviction', {
    targetId,
    zombieId: zombie.id,
    evicted: evicted.length,
  });

  return moved;
}

/**
 * Reassigns the live name change rows a sequence duplicates onto the target and
 * hides them from the profile, leaving the more accurate historic rows visible.
 */
async function reassignSupersededLiveRows(
  plan: MigrationPlan,
  targetId: number,
  db: Db,
): Promise<void> {
  const rows = plan.supersededLiveRows;
  if (rows.length === 0) {
    return;
  }

  const ids = rows.map((r) => r.id);
  await db`
    UPDATE name_changes
    SET player_id = ${targetId}, hidden_from_profile = TRUE
    WHERE id = ANY(${ids})
  `;

  logger.info('historic_live_rows_hidden', {
    targetId,
    hidden: ids.length,
    reclaimed: rows.filter((r) => r.playerId !== targetId).length,
  });
}

/**
 * Executes a migration plan against a database, consolidating the chain
 * player's scattered data onto the target record.
 * Does not delete emptied players from the plan.
 *
 * @returns The resolved target ID and the number of documents moved onto it.
 */
export async function apply(
  plan: MigrationPlan,
  db: Db = sql,
): Promise<{ targetId: number; migratedDocuments: number }> {
  const targetId = await resolveOrCreateTargetId(plan.target, db);

  let migratedDocuments = 0;

  // Split off any of the target's challenges that belong to a prior name
  // holder before consolidating scattered data onto it.
  migratedDocuments += await evictTargetHistory(plan, targetId, db);

  await reassignSupersededLiveRows(plan, targetId, db);

  const movedChallengeIds = plan.sourcePlayers.flatMap((s) => s.challengeIds);
  if (movedChallengeIds.length === 0) {
    return { targetId, migratedDocuments };
  }

  // Move all data onto the target in window order.
  for (const source of plan.sourcePlayers) {
    const window = plan.windows[source.windowIndex];
    const moved = await db`
      UPDATE challenge_players
      SET player_id = ${targetId}
      WHERE player_id = ${source.playerId}
        AND challenge_id = ANY(${source.challengeIds})
    `;
    migratedDocuments += moved.count;
    migratedDocuments += await updatePlayerStats(
      targetId,
      source.playerId,
      window.from,
      window.to,
      db,
    );
    migratedDocuments += await updateApiKeys(
      targetId,
      source.playerId,
      window.from,
      window.to,
      db,
    );
  }

  // Recompute PBs for each surviving source record and the target over each
  // of their affected windows.
  const recompute = async (playerId: number, challengeIds: number[]) => {
    const splits = await distinctAccurateSplitTypes(challengeIds, db);
    migratedDocuments += await recomputePbHistoryFrom(
      playerId,
      splits,
      Math.min(...challengeIds),
      db,
    );
  };

  await recompute(targetId, movedChallengeIds);

  const idsBySource = new Map<number, number[]>();
  for (const source of plan.sourcePlayers) {
    const ids = idsBySource.get(source.playerId) ?? [];
    ids.push(...source.challengeIds);
    idsBySource.set(source.playerId, ids);
  }
  for (const [sourceId, challengeIds] of idsBySource) {
    if (!plan.emptiedSourceIds.includes(sourceId)) {
      await recompute(sourceId, challengeIds);
    }
  }

  // Adjust each affected player's recording counts.
  await db`
    UPDATE players
    SET total_recordings = total_recordings + ${movedChallengeIds.length}
    WHERE id = ${targetId}
  `;
  for (const [sourceId, challengeIds] of idsBySource) {
    await db`
      UPDATE players
      SET total_recordings = total_recordings - ${challengeIds.length}
      WHERE id = ${sourceId}
    `;
  }

  logger.info('historic_migration_applied', {
    targetId,
    migratedDocuments,
    challengesMoved: movedChallengeIds.length,
    sourceCount: idsBySource.size,
  });

  return { targetId, migratedDocuments };
}

/**
 * Deletes player records that were emptied by a migration.
 * @returns The number of records deleted.
 */
export async function deleteEmptiedSources(
  emptiedSourceIds: number[],
  db: Db = sql,
): Promise<number> {
  if (emptiedSourceIds.length === 0) {
    return 0;
  }
  const deleted = await db`
    DELETE FROM players
    WHERE id = ANY(${emptiedSourceIds})
      AND NOT EXISTS (
        SELECT 1 FROM challenge_players WHERE player_id = players.id
      )
  `;
  return deleted.count;
}

/**
 * A human-readable projection of a {@link MigrationPlan}, resolving the plan's
 * internal IDs and window indices into names, counts, and dates for review
 * before committing a historic name change.
 */
export type DisplayPlan = {
  target: {
    name: string;
    isNew: boolean;
    challengesBefore: number;
    challengesAfter: number;
    /**
     * Date of the earliest challenge whose personal bests are recomputed on the
     * target, whether moved on or evicted off, or `null` if none.
     */
    pbRecomputedFrom: Date | null;
  };
  /** One entry per source record and name window contributing data. */
  contributions: DisplayContribution[];
  /** One entry per source record, describing its overall fate. */
  sources: DisplaySource[];
  /**
   * Challenges on the target outside of player windows, which would be evicted.
   */
  evictedChallenges: number;
  /** Prior-holder API keys on the target. */
  unownedApiKeys: number;
  /** Live name change rows this sequence duplicates and hides. */
  supersededLiveRows: DisplaySupersededLive[];
};

type DisplaySupersededLive = {
  oldName: string;
  newName: string;
  /** Date the live rename was recorded. */
  date: Date;
  /** Record currently holding the row. */
  currentOwner: string;
  /** Whether the row is attributed to a record other than the target. */
  reclaimed: boolean;
};

/** The data a single source record contributes under a single name window. */
type DisplayContribution = {
  sourceName: string;
  /** Name under which the data was recorded. */
  asName: string;
  span: { from: Date; to: Date };
  challenges: number;
  stats: number;
  apiKeys: number;
};

/**
 * What happens to a single source record overall. A deleted record is fully
 * absorbed by the target; a kept record retains data, and its personal bests
 * are recomputed from the given date.
 */
type DisplaySource =
  | { name: string; outcome: 'deleted' }
  | { name: string; outcome: 'kept'; pbRecomputedFrom: Date };

async function countChallenges(playerId: number, db: Db): Promise<number> {
  const [{ count }] = await db<[{ count: string }]>`
    SELECT COUNT(*) FROM challenge_players WHERE player_id = ${playerId}
  `;
  return parseInt(count);
}

/** Builds per-contribution display rows for a migration plan. */
async function describeContributions(
  plan: MigrationPlan,
  usernames: Map<number, string>,
  challengeDates: Map<number, Date>,
  db: Db,
): Promise<DisplayContribution[]> {
  const contributions: DisplayContribution[] = [];
  for (const source of plan.sourcePlayers) {
    const window = plan.windows[source.windowIndex];

    const times = source.challengeIds.map((id) =>
      challengeDates.get(id)!.getTime(),
    );
    const span = {
      from: new Date(Math.min(...times)),
      to: new Date(Math.max(...times)),
    };

    const [{ count: stats }] = await db<[{ count: string }]>`
      SELECT COUNT(*) FROM player_stats
      WHERE player_id = ${source.playerId}
        ${window.from !== null ? db`AND date > ${window.from}` : db``}
        ${window.to !== null ? db`AND date <= ${window.to}` : db``}
    `;

    const [{ count: apiKeys }] = await db<[{ count: string }]>`
      SELECT COUNT(*) FROM api_keys
      WHERE player_id = ${source.playerId}
        ${window.from !== null ? db`AND last_used > ${window.from}` : db``}
        ${window.to !== null ? db`AND last_used <= ${window.to}` : db``}
    `;

    contributions.push({
      sourceName: usernames.get(source.playerId)!,
      asName: window.normalizedRsn,
      span,
      challenges: source.challengeIds.length,
      stats: parseInt(stats),
      apiKeys: parseInt(apiKeys),
    });
  }

  return contributions;
}

/** Builds per-source display rows for a migration plan. */
function describeSources(
  plan: MigrationPlan,
  usernames: Map<number, string>,
  challengeDates: Map<number, Date>,
): DisplaySource[] {
  const idsByPlayer = new Map<number, number[]>();
  for (const source of plan.sourcePlayers) {
    const ids = idsByPlayer.get(source.playerId) ?? [];
    ids.push(...source.challengeIds);
    idsByPlayer.set(source.playerId, ids);
  }

  const sources: DisplaySource[] = [];
  for (const [playerId, challengeIds] of idsByPlayer) {
    const name = usernames.get(playerId)!;
    if (plan.emptiedSourceIds.includes(playerId)) {
      sources.push({ name, outcome: 'deleted' });
    } else {
      const cutoffId = Math.min(...challengeIds);
      sources.push({
        name,
        outcome: 'kept',
        pbRecomputedFrom: challengeDates.get(cutoffId)!,
      });
    }
  }

  return sources;
}

/** Builds display rows for the live name changes a sequence duplicates. */
async function describeSupersededLiveRows(
  plan: MigrationPlan,
  db: Db,
): Promise<DisplaySupersededLive[]> {
  const ids = plan.supersededLiveRows.map((r) => r.id);
  if (ids.length === 0) {
    return [];
  }

  const rows = await db<
    {
      old_name: string;
      new_name: string;
      effective_from: Date;
      player_id: number;
      owner: string;
    }[]
  >`
    SELECT
      nc.old_name,
      nc.new_name,
      nc.effective_from,
      nc.player_id,
      p.username AS owner
    FROM name_changes nc
    JOIN players p ON p.id = nc.player_id
    WHERE nc.id = ANY(${ids})
  `;

  const targetPlayerId =
    plan.target.action === 'use' ? plan.target.playerId : null;

  return rows.map((r) => ({
    oldName: r.old_name,
    newName: r.new_name,
    date: r.effective_from,
    currentOwner: r.owner,
    reclaimed: r.player_id !== targetPlayerId,
  }));
}

/** Resolves a migration plan into a human-readable preview. Read-only. */
export async function formatPlan(
  plan: MigrationPlan,
  db: Db = sql,
): Promise<DisplayPlan> {
  const movedIds = plan.sourcePlayers.flatMap((s) => s.challengeIds);

  // Resolve the names and dates the projection needs in one batch each.
  const sourceIds = [...new Set(plan.sourcePlayers.map((s) => s.playerId))];
  const nameRows = sourceIds.length
    ? await db<{ id: number; username: string }[]>`
        SELECT id, username FROM players WHERE id = ANY(${sourceIds})
      `
    : [];
  const usernames = new Map(nameRows.map((r) => [r.id, r.username]));

  const affectedIds = [...movedIds, ...plan.evictedTargetChallengeIds];
  const dateRows = affectedIds.length
    ? await db<{ id: number; start_time: Date }[]>`
        SELECT id, start_time FROM challenges WHERE id = ANY(${affectedIds})
      `
    : [];
  const challengeDates = new Map(dateRows.map((r) => [r.id, r.start_time]));

  let name: string;
  let challengesBefore: number;
  if (plan.target.action === 'use') {
    const [player]: [{ username: string }?] = await db`
      SELECT username FROM players WHERE id = ${plan.target.playerId}
    `;
    name = player!.username;
    challengesBefore = await countChallenges(plan.target.playerId, db);
  } else {
    name = plan.target.currentName;
    challengesBefore = 0;
  }

  // The target's PBs recompute from the earliest moved or evicted challenge.
  const targetCutoffId =
    affectedIds.length > 0 ? Math.min(...affectedIds) : null;
  const targetPbRecomputedFrom =
    targetCutoffId !== null ? challengeDates.get(targetCutoffId)! : null;

  const contributions = await describeContributions(
    plan,
    usernames,
    challengeDates,
    db,
  );
  const sources = describeSources(plan, usernames, challengeDates);
  const supersededLiveRows = await describeSupersededLiveRows(plan, db);

  return {
    target: {
      name,
      isNew: plan.target.action === 'create',
      challengesBefore,
      challengesAfter:
        challengesBefore +
        movedIds.length -
        plan.evictedTargetChallengeIds.length,
      pbRecomputedFrom: targetPbRecomputedFrom,
    },
    contributions,
    sources,
    evictedChallenges: plan.evictedTargetChallengeIds.length,
    unownedApiKeys: plan.unownedApiKeyCount,
    supersededLiveRows,
  };
}

export type DryRunResult =
  { ok: true; plan: DisplayPlan } | { ok: false; error: ChainError };

/**
 * Previews a historic name change chain without mutating any data.
 *
 * @param chain The historic sequence of name changes.
 * @returns Plan detailing how the sequence would be migrated, or a validation
 *   error if the sequence is invalid.
 */
export async function dryRunHistoricNameChange(
  chain: ChainTransition[],
): Promise<DryRunResult> {
  const error = validateChain(chain);
  if (error !== null) {
    return { ok: false, error };
  }

  const plan = await decide(chain);
  return { ok: true, plan: await formatPlan(plan) };
}

function compareExperience(
  before: PlayerExperience,
  after: PlayerExperience,
): Skill[] {
  const decreasedSkills: Skill[] = [];

  Object.keys(before).forEach((key) => {
    const skill = parseInt(key) as Skill;
    if (before[skill] !== 0 && after[skill] < before[skill]) {
      decreasedSkills.push(skill);
    }
  });

  return decreasedSkills;
}

type NameChangeQueryResult = {
  id: number;
  old_name: string;
  new_name: string;
  player_id: number;
  skip_checks: boolean;
  kind: NameChangeKind;
  effective_from: Date;
  effective_to: Date | null;
  sequence_id: string | null;
  overall_experience: string;
  attack_experience: number;
  defence_experience: number;
  strength_experience: number;
  hitpoints_experience: number;
  ranged_experience: number;
  prayer_experience: number;
  magic_experience: number;
};

export async function processNameChange(
  changeId: number,
  db: Db = sql,
): Promise<NameChangeUpdate | null> {
  const [nameChange]: [NameChangeQueryResult?] = await db`
    SELECT
      name_changes.id,
      name_changes.old_name,
      name_changes.new_name,
      name_changes.player_id,
      name_changes.skip_checks,
      name_changes.kind,
      name_changes.effective_from,
      name_changes.effective_to,
      name_changes.sequence_id,
      players.overall_experience,
      players.attack_experience,
      players.defence_experience,
      players.strength_experience,
      players.hitpoints_experience,
      players.ranged_experience,
      players.prayer_experience,
      players.magic_experience
    FROM name_changes
    JOIN players ON name_changes.player_id = players.id
    WHERE name_changes.id = ${changeId}
  `;
  if (!nameChange) {
    logger.warn('name_change_not_found', { changeId });
    return null;
  }

  if (nameChange.kind === NameChangeKind.HISTORIC) {
    throw new Error(
      'historic name changes should not be processed via processNameChange',
    );
  }

  return processStandardNameChange(nameChange, db);
}

async function processStandardNameChange(
  nameChange: NameChangeQueryResult,
  db: Db,
): Promise<NameChangeUpdate | null> {
  const {
    id: changeId,
    old_name: oldName,
    new_name: newName,
    player_id: playerId,
  } = nameChange;

  logger.info('processing_name_change', { changeId, oldName, newName });

  // If the names normalize to the same value, this is just a display name
  // update. Skip validation and simply update the stored display name.
  if (normalizeRsn(oldName) === normalizeRsn(newName)) {
    logger.info('name_change_display_only', { changeId, oldName, newName });

    const now = new Date();
    await Promise.all([
      db`UPDATE players SET username = ${newName} WHERE id = ${playerId}`,
      db`
        UPDATE name_changes
        SET
          status = ${NameChangeStatus.ACCEPTED},
          processed_at = ${now},
          effective_from = ${now}
        WHERE id = ${changeId}
      `,
    ]);

    return {
      type: NameChangeUpdateType.RENAMED,
      playerId,
      oldName,
      newName,
    };
  }

  // Check if the player is in an active challenge. If so, defer the name
  // change until they are no longer in a challenge.
  if (await isPlayerInActiveChallenge(oldName, newName)) {
    throw new PlayerInActiveChallengeError(changeId);
  }

  let oldExperience: PlayerExperience | null = null;
  let newExperience: PlayerExperience | null = null;

  try {
    const [expOld, expNew] = await Promise.all([
      hiscoreLookup(oldName),
      hiscoreLookup(newName),
    ]);
    oldExperience = expOld;
    newExperience = expNew;
  } catch (e: any) {
    if (e instanceof HiscoresRateLimitError) {
      logger.info('hiscores_rate_limited', { changeId });
      return null;
    }

    logger.error('hiscores_lookup_failed', {
      changeId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }

  let nameChangeStatus = NameChangeStatus.PENDING;

  const playerUpdates: Record<string, any> = {
    username: newName,
    normalized_username: normalizeRsn(newName),
  };

  if (oldExperience !== null) {
    nameChangeStatus = NameChangeStatus.OLD_STILL_IN_USE;
    logger.info('name_change_rejected', {
      changeId,
      reason: 'old_still_exists',
    });
  } else if (newExperience === null) {
    nameChangeStatus = NameChangeStatus.NEW_DOES_NOT_EXIST;
    logger.info('name_change_rejected', {
      changeId,
      reason: 'new_does_not_exist',
    });
  } else {
    const playerExperience = {
      [Skill.OVERALL]: parseInt(nameChange.overall_experience),
      [Skill.ATTACK]: nameChange.attack_experience,
      [Skill.DEFENCE]: nameChange.defence_experience,
      [Skill.STRENGTH]: nameChange.strength_experience,
      [Skill.HITPOINTS]: nameChange.hitpoints_experience,
      [Skill.RANGED]: nameChange.ranged_experience,
      [Skill.PRAYER]: nameChange.prayer_experience,
      [Skill.MAGIC]: nameChange.magic_experience,
    };
    const decreasedSkills = compareExperience(playerExperience, newExperience);
    if (decreasedSkills.length > 0) {
      logger.info('name_change_rejected', {
        changeId,
        reason: 'decreased_experience',
        skills: decreasedSkills,
      });
      nameChangeStatus = NameChangeStatus.DECREASED_EXPERIENCE;
    }
  }

  if (nameChangeStatus !== NameChangeStatus.PENDING) {
    if (!nameChange.skip_checks) {
      await db`
        UPDATE name_changes
        SET status = ${nameChangeStatus}, processed_at = ${new Date()}
        WHERE id = ${changeId}
      `;
      return null;
    }

    logger.info('name_change_skip_checks', {
      changeId,
      status: nameChangeStatus,
    });
    nameChangeStatus = NameChangeStatus.ACCEPTED;
  }

  let migratedDocuments = 0;
  let deletedPlayerId: number | null = null;

  const [newPlayer]: [{ id: number }?] = await db`
    SELECT id
    FROM players
    WHERE normalized_username = ${normalizeRsn(newName)}
  `;

  if (newPlayer) {
    let newPlayerPreviouslyExisted = false;
    let challengesUpdated = 0;

    const [lastRecordedChallenge]: [{ start_time: Date }?] = await db`
      SELECT challenges.start_time
      FROM challenges
      JOIN challenge_players ON challenges.id = challenge_players.challenge_id
      WHERE challenge_players.player_id = ${playerId}
      ORDER BY challenges.start_time DESC
      LIMIT 1
    `;
    if (lastRecordedChallenge !== undefined) {
      const updateFrom = lastRecordedChallenge.start_time;
      const challengesToUpdateRows = await db<{ id: number }[]>`
        SELECT challenges.id
        FROM challenges
        JOIN challenge_players ON challenges.id = challenge_players.challenge_id
        WHERE challenge_players.player_id = ${newPlayer.id}
          AND challenges.start_time > ${updateFrom}
      `;
      const challengesToUpdate = challengesToUpdateRows.map((r) => r.id);

      const [challengesBefore] = await db`
        SELECT 1
        FROM challenges
        JOIN challenge_players ON challenges.id = challenge_players.challenge_id
        WHERE
          player_id = ${newPlayer.id}
          AND start_time <= ${updateFrom}
        `;
      newPlayerPreviouslyExisted = challengesBefore !== undefined;
      logger.info('name_change_challenges_to_migrate', {
        changeId,
        newName,
        count: challengesToUpdate.length,
      });

      // Update players serially as the other migrations depend on
      // player-challenge associations.
      const updatedPlayerCount = await db`
        UPDATE challenge_players
        SET player_id = ${playerId}
        WHERE
          player_id = ${newPlayer.id}
          AND challenge_id = ANY(${challengesToUpdate})
      `.then((res) => res.count);
      migratedDocuments += updatedPlayerCount;

      const modifiedDocuments = await Promise.all([
        updateApiKeys(playerId, newPlayer.id, updateFrom, null, db),
        updatePersonalBestHistory(
          playerId,
          newPlayer.id,
          challengesToUpdate,
          db,
        ),
        updatePlayerStats(playerId, newPlayer.id, updateFrom, null, db),
      ]);

      challengesUpdated = challengesToUpdate.length;
      migratedDocuments += modifiedDocuments.reduce((a, b) => a + b, 0);
    }

    playerUpdates.total_recordings = sql`total_recordings + ${challengesUpdated}`;

    if (newPlayerPreviouslyExisted) {
      // The username was previously used by another player who has not updated
      // their username. Keep the old player around in a "zombie" state. This is
      // denoted by prefixing the username with an asterisk, which is not a
      // valid character in OSRS usernames.
      //
      // Additionally, reset all of the player's experience to 0, as their
      // current values reflect the experience of the player who has taken over
      // the username.
      logger.info('name_change_zombie_player', { changeId, newName });
      const zombie = zombieName(newName);
      await db`
        UPDATE players
        SET
          username = ${zombie},
          normalized_username = ${normalizeRsn(zombie)},
          total_recordings = total_recordings - ${challengesUpdated},
          overall_experience = 0,
          attack_experience = 0,
          defence_experience = 0,
          strength_experience = 0,
          hitpoints_experience = 0,
          ranged_experience = 0,
          prayer_experience = 0,
          magic_experience = 0
        WHERE id = ${newPlayer.id}
      `;
    } else {
      await db`DELETE FROM players WHERE id = ${newPlayer.id}`;
      deletedPlayerId = newPlayer.id;
    }
  }

  if (newExperience !== null) {
    playerUpdates.overall_experience = newExperience[Skill.OVERALL];
    playerUpdates.attack_experience = newExperience[Skill.ATTACK];
    playerUpdates.defence_experience = newExperience[Skill.DEFENCE];
    playerUpdates.strength_experience = newExperience[Skill.STRENGTH];
    playerUpdates.hitpoints_experience = newExperience[Skill.HITPOINTS];
    playerUpdates.ranged_experience = newExperience[Skill.RANGED];
    playerUpdates.prayer_experience = newExperience[Skill.PRAYER];
    playerUpdates.magic_experience = newExperience[Skill.MAGIC];
  }

  // Final check: if the player started a new challenge while we were
  // processing, abort the transaction and defer the name change.
  if (await isPlayerInActiveChallenge(oldName, newName)) {
    throw new PlayerInActiveChallengeError(changeId);
  }

  const updatePlayer = db`
    UPDATE players SET ${sql(playerUpdates)} WHERE id = ${playerId}
  `;

  const acceptedAt = new Date();
  const updateNameChange = db`
    UPDATE name_changes
    SET
      status = ${NameChangeStatus.ACCEPTED},
      processed_at = ${acceptedAt},
      effective_from = ${acceptedAt},
      migrated_documents = ${migratedDocuments}
    WHERE id = ${changeId}
  `;

  await Promise.all([updatePlayer, updateNameChange]);

  if (deletedPlayerId !== null) {
    return {
      type: NameChangeUpdateType.MERGED,
      deletedPlayerId,
      remainingPlayerId: playerId,
      oldName,
      newName,
    };
  }

  return {
    type: NameChangeUpdateType.RENAMED,
    playerId,
    oldName,
    newName,
  };
}

class PlayerInActiveChallengeError extends Error {
  public readonly changeId: number;

  constructor(changeId: number) {
    super(`Player in active challenge during name change processing`);
    this.changeId = changeId;
  }
}

export type HistoricSequenceResult =
  'processed' | 'unavailable' | 'not_found' | 'failed';

/**
 * Processes a pending historic name change sequence, consolidating the player's
 * scattered data onto their current record.
 */
async function processHistoricSequence(
  sequenceId: string,
): Promise<HistoricSequenceResult> {
  const applied = await sql.begin(async (tx) => {
    const [{ locked }] = await tx<[{ locked: boolean }]>`
      SELECT pg_try_advisory_xact_lock(17, hashtext(${sequenceId})) AS locked
    `;
    if (!locked) {
      return 'unavailable' as const;
    }

    const rows = await tx<
      Pick<NameChangeQueryResult, 'old_name' | 'new_name' | 'effective_from'>[]
    >`
      SELECT old_name, new_name, effective_from
      FROM name_changes
      WHERE sequence_id = ${sequenceId}
        AND status = ${NameChangeStatus.PENDING}
      ORDER BY effective_from
      FOR UPDATE
    `;
    if (rows.length === 0) {
      return 'not_found' as const;
    }

    const chain = chainFromHistoricSequence(rows);
    const plan = await decide(chain, tx);
    const { targetId, migratedDocuments } = await apply(plan, tx);

    // Mark accepted. `effective_from` already holds the rename date.
    await tx`
      UPDATE name_changes
      SET
        status = ${NameChangeStatus.ACCEPTED},
        player_id = ${targetId},
        processed_at = ${new Date()},
        migrated_documents = ${migratedDocuments}
      WHERE sequence_id = ${sequenceId}
    `;

    return { emptiedSourceIds: plan.emptiedSourceIds, migratedDocuments };
  });

  if (applied === 'unavailable' || applied === 'not_found') {
    return applied;
  }

  // Delete empty players as a separate pass after the migration to avoid
  // deciding emptiness from an early transaction snapshot.
  const deleted = await deleteEmptiedSources(applied.emptiedSourceIds);
  logger.info('historic_sequence_accepted', {
    sequenceId,
    migratedDocuments: applied.migratedDocuments,
    recordsDeleted: deleted,
  });
  return 'processed';
}

export type BatchProcessingResult = {
  /** Number of name changes successfully processed. */
  processed: number;
  /** Number of name changes deferred due to active challenges. */
  deferred: number;
  /** Number of deferred name changes promoted back to pending. */
  promoted: number;
};

type NameChangeProcessorConfig = {
  /** Interval between batch processing runs in milliseconds. */
  period: number;
  /** Maximum number of name changes to process per batch. */
  batchSize: number;
  /** Whether to automatically start processing on construction. */
  autoStart: boolean;
};

const DEFAULT_CONFIG: NameChangeProcessorConfig = {
  period: 1000 * 5,
  batchSize: 5,
  autoStart: process.env.NODE_ENV === 'production',
};

export class NameChangeProcessor {
  private readonly config: NameChangeProcessorConfig;

  // For whatever reason, Next likes to create multiple instances of this class
  // sometimes, so we use a single global timeout.
  private static timeout: NodeJS.Timeout | null = null;

  public constructor(config: Partial<NameChangeProcessorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoStart) {
      this.start();
    }
  }

  public start(): void {
    NameChangeProcessor.timeout ??= setTimeout(
      () => void this.runBatchLoop(),
      this.config.period,
    );
  }

  public stop(): void {
    if (NameChangeProcessor.timeout !== null) {
      clearTimeout(NameChangeProcessor.timeout);
      NameChangeProcessor.timeout = null;
    }
  }

  /**
   * Processes a single batch of name changes.
   */
  public async processBatch(): Promise<BatchProcessingResult> {
    const result: BatchProcessingResult = {
      processed: 0,
      deferred: 0,
      promoted: 0,
    };

    for (let i = 0; i < this.config.batchSize; i++) {
      try {
        const txResult = await sql.begin(async (tx) => {
          const [row]: [{ id: number }?] = await tx`
            SELECT id
            FROM name_changes
            WHERE status = ${NameChangeStatus.PENDING}
              AND kind = ${NameChangeKind.STANDARD}
            ORDER BY id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          `;

          if (!row) {
            return { processed: false, update: null };
          }

          const update = await processNameChange(row.id, tx);
          return { processed: true, update };
        });

        if (!txResult.processed) {
          break;
        }

        result.processed += 1;
        if (txResult.update) {
          const { oldName, newName } = txResult.update;
          logger.info('name_change_accepted', { oldName, newName });

          // Notify other services of the name change.
          await publishNameChangeUpdate(txResult.update);
        }
      } catch (e) {
        if (e instanceof PlayerInActiveChallengeError) {
          await sql`
            UPDATE name_changes
            SET status = ${NameChangeStatus.DEFERRED}
            WHERE id = ${e.changeId} AND status = ${NameChangeStatus.PENDING}
          `;
          result.deferred += 1;
        } else {
          logger.error('name_change_error', {
            error: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
          });
        }
      }
    }

    // Check DEFERRED entries that may now be ready to process.
    const deferredEntries = await sql<
      { id: number; old_name: string; new_name: string }[]
    >`
      SELECT id, old_name, new_name
      FROM name_changes
      WHERE status = ${NameChangeStatus.DEFERRED}
      ORDER BY id
      LIMIT ${this.config.batchSize}
    `;

    for (const entry of deferredEntries) {
      if (!(await isPlayerInActiveChallenge(entry.old_name, entry.new_name))) {
        // Player is no longer in an active challenge. Promote to PENDING so
        // normal processing will handle it on the next batch.
        const [updated] = await sql<[{ id: number }?]>`
          UPDATE name_changes
          SET status = ${NameChangeStatus.PENDING}
          WHERE id = ${entry.id} AND status = ${NameChangeStatus.DEFERRED}
          RETURNING id
        `;
        if (updated) {
          logger.info('name_change_promoted', { changeId: entry.id });
          result.promoted += 1;
        }
      }
    }

    return result;
  }

  /**
   * Processes the oldest pending historic name change sequence, if any.
   */
  public async processNextHistoricSequence(): Promise<HistoricSequenceResult> {
    const [row] = await sql<[{ sequence_id: string }?]>`
      SELECT sequence_id
      FROM name_changes
      WHERE status = ${NameChangeStatus.PENDING}
        AND kind = ${NameChangeKind.HISTORIC}
      ORDER BY effective_from
      LIMIT 1
    `;
    if (!row) {
      return 'not_found';
    }
    try {
      return await processHistoricSequence(row.sequence_id);
    } catch (e) {
      if (e instanceof UnownedApiKeysError) {
        await sql`
          UPDATE name_changes
          SET status = ${NameChangeStatus.FAILED}, processed_at = ${new Date()}
          WHERE sequence_id = ${row.sequence_id}
            AND status = ${NameChangeStatus.PENDING}
        `;
        logger.warn('historic_sequence_failed', {
          sequenceId: row.sequence_id,
          reason: 'unowned_api_keys',
          keyCount: e.count,
        });
        return 'failed';
      }
      logger.error('historic_sequence_error', {
        sequenceId: row.sequence_id,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
      throw e;
    }
  }

  private async runBatchLoop(): Promise<void> {
    try {
      const result = await this.processBatch();
      logger.info('name_change_batch_complete', {
        processed: result.processed,
        deferred: result.deferred,
        promoted: result.promoted,
      });
    } catch (e) {
      logger.error('name_change_batch_error', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      await this.processNextHistoricSequence();
    } catch {
      // Errors are logged with their sequence id inside the method.
    }

    NameChangeProcessor.timeout = setTimeout(
      () => void this.runBatchLoop(),
      this.config.period,
    );
  }
}

const processor = new NameChangeProcessor();
export default processor;
