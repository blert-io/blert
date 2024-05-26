import {
  HiscoresRateLimitError,
  NameChangeStatus,
  PlayerExperience,
  Skill,
  hiscoreLookup,
} from '@blert/common';

import { sql } from './db';

async function updatePlayerStats(
  oldPlayerId: number,
  newPlayerId: number,
  fromDate: Date,
): Promise<number> {
  const [lastStats] = await sql`
    SELECT *
    FROM player_stats
    WHERE player_id = ${oldPlayerId}
    AND date <= ${fromDate}
    ORDER BY date DESC
    LIMIT 1
  `;

  const [newPlayerLastStats] = await sql`
    SELECT *
    FROM player_stats
    WHERE player_id = ${newPlayerId}
    AND date <= ${fromDate}
    ORDER BY date DESC
    LIMIT 1
  `;

  const statsToMigrate = await sql`
    SELECT *
    FROM player_stats
    WHERE player_id = ${newPlayerId}
    AND date > ${fromDate}
  `;

  // Reassign the new player's stats to the old player, adjusting the values by
  // the difference accumulated since the fromDate.
  for (const stats of statsToMigrate) {
    const newStats: Record<string, number> = {
      player_id: oldPlayerId,
    };

    Object.entries(stats).forEach(([key, value]) => {
      if (key === 'id' || key === 'player_id' || typeof value !== 'number') {
        return;
      }
      const base = newPlayerLastStats?.[key] ?? 0;
      const delta = value - base;
      const old = lastStats?.[key] ?? 0;
      newStats[key] = old + delta;
    });

    await sql`
      UPDATE player_stats SET ${sql(newStats)} WHERE id = ${stats.id}
    `;
  }

  return statsToMigrate.length;
}

async function updateApiKeys(
  oldPlayerId: number,
  newPlayerId: number,
  fromDate: Date,
): Promise<number> {
  const updated = await sql`
    UPDATE api_keys
    SET player_id = ${oldPlayerId}
    WHERE player_id = ${newPlayerId} AND last_used > ${fromDate}
  `;

  // Delete unused keys for the new player.
  const deleted = await sql`
    DELETE FROM api_keys
    WHERE player_id = ${newPlayerId} AND last_used IS NULL
  `;

  return updated.count + deleted.count;
}

type PersonalBestQueryResult = {
  challenge_split_id: number;
  type: number;
  scale: number;
  ticks: number;
};

async function updatePersonalBests(
  oldPlayerId: number,
  newPlayerId: number,
  challengeIds: number[],
  reassignNewPlayerPbs: boolean,
): Promise<number> {
  const newPlayerPersonalBests = await sql<PersonalBestQueryResult[]>`
    SELECT
      personal_bests.challenge_split_id,  
      challenge_splits.type,
      challenge_splits.scale,
      challenge_splits.ticks
    FROM personal_bests
    JOIN challenge_splits ON personal_bests.challenge_split_id = challenge_splits.id
    WHERE
      personal_bests.player_id = ${newPlayerId}
      AND challenge_splits.challenge_id = ANY(${challengeIds})
  `;

  const oldPlayerPersonalBests = await sql<PersonalBestQueryResult[]>`
    SELECT
      personal_bests.challenge_split_id,  
      challenge_splits.type,
      challenge_splits.scale,
      challenge_splits.ticks
    FROM personal_bests
    JOIN challenge_splits ON personal_bests.challenge_split_id = challenge_splits.id
    WHERE
      personal_bests.player_id = ${oldPlayerId}
      AND (challenge_splits.type, challenge_splits.scale) IN ${sql(
        newPlayerPersonalBests.map((pb) => sql([pb.type, pb.scale])),
      )}
  `;

  for (const newPb of newPlayerPersonalBests) {
    const oldPb = oldPlayerPersonalBests.find(
      (pb) => pb.type === newPb.type && pb.scale === newPb.scale,
    );

    // Either delete or migrate the new player's PBs to the old player.
    if (oldPb === undefined || oldPb.ticks > newPb.ticks) {
      if (oldPb !== undefined) {
        await sql`
          DELETE FROM personal_bests
          WHERE
            player_id = ${oldPlayerId}
            AND challenge_split_id = ${oldPb.challenge_split_id}
        `;
      }
      await sql`
        UPDATE personal_bests
        SET player_id = ${oldPlayerId}
        WHERE
          player_id = ${newPlayerId}
          AND challenge_split_id = ${newPb.challenge_split_id}
      `;
    } else {
      await sql`
        DELETE FROM personal_bests
        WHERE
          player_id = ${newPlayerId}
          AND challenge_split_id = ${newPb.challenge_split_id}
      `;
    }
  }

  let migratedDocuments = newPlayerPersonalBests.length;

  if (reassignNewPlayerPbs) {
    // If a player with the new name previously existed, reassign the personal
    // bests that were deleted based on their older challenges.
    const pbsToInsert: Array<{
      player_id: number;
      challenge_split_id: number;
    }> = [];

    for (const pb of newPlayerPersonalBests) {
      const [previousPbSplit] = await sql`
        SELECT challenge_splits.id
        FROM challenge_players
        JOIN challenge_splits ON challenge_players.challenge_id = challenge_splits.challenge_id
        WHERE
          challenge_players.player_id = ${newPlayerId}
          AND challenge_splits.type = ${pb.type}
          AND challenge_splits.scale = ${pb.scale}
          AND challenge_splits.accurate
        ORDER BY challenge_splits.ticks ASC
        LIMIT 1
      `;
      if (previousPbSplit !== undefined) {
        pbsToInsert.push({
          player_id: newPlayerId,
          challenge_split_id: previousPbSplit.id,
        });
      }
    }

    if (pbsToInsert.length > 0) {
      await sql`INSERT INTO personal_bests ${sql(pbsToInsert)}`;
      migratedDocuments += pbsToInsert.length;
    }
  }

  return migratedDocuments;
}

function compareExperience(
  before: PlayerExperience,
  after: PlayerExperience,
): Skill[] {
  const decreasedSkills: Skill[] = [];

  Object.keys(before).forEach((key) => {
    const skill = parseInt(key) as Skill;
    if (before[skill] !== 0 && after[skill] < before[skill]) {
      decreasedSkills.push(skill as Skill);
    }
  });

  return decreasedSkills;
}

type NameChangeQueryResult = {
  id: number;
  old_name: string;
  new_name: string;
  player_id: number;
  overall_experience: string;
  attack_experience: number;
  defence_experience: number;
  strength_experience: number;
  hitpoints_experience: number;
  ranged_experience: number;
  prayer_experience: number;
  magic_experience: number;
};

export async function processNameChange(changeId: number) {
  const [nameChange]: [NameChangeQueryResult?] = await sql`
    SELECT
      name_changes.id,
      name_changes.old_name,
      name_changes.new_name,
      name_changes.player_id,
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
    console.log(`Name change not found: ${changeId}`);
    return;
  }

  const {
    old_name: oldName,
    new_name: newName,
    player_id: playerId,
  } = nameChange;

  console.log(
    `Processing name change request ${changeId}: ${oldName} -> ${newName}`,
  );

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
      console.log('Hiscores rate limit reached, retrying later');
      return;
    }

    console.error(`Failed to look up experience for name change ${changeId}`);
    console.error(e);
    return;
  }

  let nameChangeStatus = NameChangeStatus.PENDING;

  let playerUpdates: Record<string, any> = {
    username: newName,
  };

  if (oldExperience !== null) {
    nameChangeStatus = NameChangeStatus.OLD_STILL_IN_USE;
    console.log(`Name change ${changeId} rejected: old player still exists`);
  } else if (newExperience === null) {
    nameChangeStatus = NameChangeStatus.NEW_DOES_NOT_EXIST;
    console.log(`Name change ${changeId} rejected: new player does not exist`);
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
      console.log(
        `Name change ${changeId} rejected: decreased experience in ${decreasedSkills.join(', ')}`,
      );
      nameChangeStatus = NameChangeStatus.DECREASED_EXPERIENCE;
    }
  }

  if (nameChangeStatus !== NameChangeStatus.PENDING) {
    await sql`
      UPDATE name_changes
      SET status = ${nameChangeStatus}, processed_at = ${new Date()}
      WHERE id = ${changeId}
    `;
    return;
  }

  let migratedDocuments = 0;

  const [newPlayer]: [{ id: number }?] = await sql`
    SELECT id
    FROM players
    WHERE lower(username) = ${newName.toLowerCase()}
  `;

  if (newPlayer) {
    let newPlayerPreviouslyExisted = false;
    let challengesUpdated = 0;

    const [lastRecordedChallenge]: [{ start_time: Date }?] = await sql`
      SELECT challenges.start_time
      FROM challenges
      JOIN challenge_players ON challenges.id = challenge_players.challenge_id
      WHERE challenge_players.player_id = ${playerId}
      ORDER BY challenges.start_time DESC
      LIMIT 1
    `;
    if (lastRecordedChallenge !== undefined) {
      const updateFrom = lastRecordedChallenge.start_time;
      const challengesToUpdate = await sql`
        SELECT challenges.id
        FROM challenges
        JOIN challenge_players ON challenges.id = challenge_players.challenge_id
        WHERE challenge_players.player_id = ${newPlayer.id}
          AND challenges.start_time > ${updateFrom}
      `.then((res) => res.map((r) => r.id as number));

      const [challengesBefore] = await sql`
        SELECT 1
        FROM challenges
        JOIN challenge_players ON challenges.id = challenge_players.challenge_id
        WHERE
          player_id = ${newPlayer.id}
          AND start_time <= ${updateFrom}
        `;
      newPlayerPreviouslyExisted = challengesBefore !== undefined;
      console.log(
        `Player "${newName}" has recorded ${challengesToUpdate.length} ` +
          `challenges since name change`,
      );

      const updateChallengePlayers = sql`
        UPDATE challenge_players
        SET player_id = ${playerId}
        WHERE
          player_id = ${newPlayer.id}
          AND challenge_id = ANY(${challengesToUpdate})
      `.then((res) => res.count);

      const modifiedDocuments = await Promise.all([
        updateChallengePlayers,
        updateApiKeys(playerId, newPlayer.id, updateFrom),
        updatePersonalBests(
          playerId,
          newPlayer.id,
          challengesToUpdate,
          newPlayerPreviouslyExisted,
        ),
        updatePlayerStats(playerId, newPlayer.id, updateFrom),
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
      console.log(
        `Previously-existing "${newName}" has been renamed to "*${newName}"`,
      );
      await sql`
        UPDATE players
        SET
          username = ${`*${newName}`},
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
      await sql`DELETE FROM players WHERE id = ${newPlayer.id}`;
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

  const updatePlayer = sql`
    UPDATE players SET ${sql(playerUpdates)} WHERE id = ${playerId}
  `;

  const updateNameChange = sql`
    UPDATE name_changes
    SET
      status = ${NameChangeStatus.ACCEPTED},
      processed_at = ${new Date()},
      migrated_documents = ${migratedDocuments}
    WHERE id = ${changeId}
  `;

  await Promise.all([updatePlayer, updateNameChange]);
  console.log(`Name change accepted: ${oldName} -> ${newName}`);
}

class NameChangeProcessor {
  private static readonly NAME_CHANGE_PERIOD = 1000 * 5;
  private static readonly NAME_CHANGES_PER_BATCH = 5;

  private timeout: NodeJS.Timeout | null = null;

  public constructor() {
    if (process.env.NODE_ENV === 'production') {
      this.timeout = setTimeout(
        () => this.processNameChangeBatch(),
        NameChangeProcessor.NAME_CHANGE_PERIOD,
      );
    }
  }

  public start() {
    if (this.timeout === null) {
      this.timeout = setTimeout(
        () => this.processNameChangeBatch(),
        NameChangeProcessor.NAME_CHANGE_PERIOD,
      );
    }
  }

  public stop() {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  private async processNameChangeBatch() {
    const ids = await sql`
      SELECT id
      FROM name_changes
      WHERE status = ${NameChangeStatus.PENDING}
      LIMIT ${NameChangeProcessor.NAME_CHANGES_PER_BATCH}
    `;

    console.log(`Processing ${ids.length} name change requests`);

    for (const { id } of ids) {
      await processNameChange(id);
    }

    this.timeout = setTimeout(
      () => this.processNameChangeBatch(),
      NameChangeProcessor.NAME_CHANGE_PERIOD,
    );
  }
}

export default new NameChangeProcessor();
