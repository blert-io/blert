import {
  activePlayerKey,
  CamelToSnakeCase,
  HiscoresRateLimitError,
  NAME_CHANGE_PUBSUB_KEY,
  NameChangeStatus,
  NameChangeUpdate,
  NameChangeUpdateType,
  PlayerExperience,
  PlayerStats,
  Skill,
  hiscoreLookup,
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

export async function updatePlayerStats(
  targetPlayerId: number,
  sourcePlayerId: number,
  fromDate: Date,
  toDate: Date | null = null,
  db: Db = sql,
): Promise<number> {
  const [targetPlayerLastStats] = await db<[PlayerStatsRow?]>`
    SELECT *
    FROM player_stats
    WHERE player_id = ${targetPlayerId}
    AND date <= ${fromDate}
    ORDER BY date DESC
    LIMIT 1
  `;

  const [sourcePlayerLastStats] = await db<[PlayerStatsRow?]>`
    SELECT *
    FROM player_stats
    WHERE player_id = ${sourcePlayerId}
    AND date <= ${fromDate}
    ORDER BY date DESC
    LIMIT 1
  `;

  const statsToMigrate = await db<PlayerStatsRow[]>`
    SELECT *
    FROM player_stats
    WHERE player_id = ${sourcePlayerId}
    AND date > ${fromDate}
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
 * @param fromDate Start date of the migration window.
 * @param toDate Optional end date of the migration window.
 * @param db The database connection.
 * @returns The number of API keys reassigned.
 */
export async function updateApiKeys(
  targetPlayerId: number,
  sourcePlayerId: number,
  fromDate: Date,
  toDate: Date | null = null,
  db: Db = sql,
): Promise<number> {
  const updated = await db`
    UPDATE api_keys
    SET player_id = ${targetPlayerId}
    WHERE player_id = ${sourcePlayerId}
      AND last_used > ${fromDate}
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

  const {
    old_name: oldName,
    new_name: newName,
    player_id: playerId,
  } = nameChange;

  logger.info('processing_name_change', { changeId, oldName, newName });

  // If the names normalize to the same value, this is just a display name
  // update. Skip validation and simply update the stored display name.
  if (normalizeRsn(oldName) === normalizeRsn(newName)) {
    logger.info('name_change_display_only', { changeId, oldName, newName });

    await Promise.all([
      db`UPDATE players SET username = ${newName} WHERE id = ${playerId}`,
      db`
        UPDATE name_changes
        SET
          status = ${NameChangeStatus.ACCEPTED},
          processed_at = ${new Date()}
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
      const zombieName = `*${newName}`;
      await db`
        UPDATE players
        SET
          username = ${zombieName},
          normalized_username = ${normalizeRsn(zombieName)},
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

  const updateNameChange = db`
    UPDATE name_changes
    SET
      status = ${NameChangeStatus.ACCEPTED},
      processed_at = ${new Date()},
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

    NameChangeProcessor.timeout = setTimeout(
      () => void this.runBatchLoop(),
      this.config.period,
    );
  }
}

const processor = new NameChangeProcessor();
export default processor;
