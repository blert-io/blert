import mongoose, { HydratedDocument, Types } from 'mongoose';
import postgres from 'postgres';
import { mkdir, writeFile } from 'fs/promises';
import { Empty as EmptyProto } from 'google-protobuf/google/protobuf/empty_pb';

import { ApiKeyModel } from '../models/api-key';
import { PlayerModel, PlayerStatsModel } from '../models/player';
import { RaidModel } from '../models/raid';
import { RoomEvent } from '../models/room-event';
import { RecordedChallengeModel, UserModel } from '../models/user';
import { QueryableEventField } from '../db/queryable-event';
import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  MaidenCrab,
  MaidenCrabPosition,
  MaidenCrabSpawn,
  Nylo,
  NyloSpawn,
  NyloStyle,
  PrimaryMeleeGear,
  Raid,
  RoomNpc,
  RoomNpcType,
  SkillLevel,
  Stage,
  OldColosseumChallenge,
  OldTobRaid,
  OldTobRooms,
  VerzikCrab,
  VerzikCrabSpawn,
  VerzikPhase,
  PlayerAttack,
  NpcAttack,
} from '../raid-definitions';
import { SplitType, adjustSplitForMode } from '../split';
import {
  BasicEventNpc,
  BloatDownEvent,
  Event,
  EventType,
  MaidenBloodSplatsEvent,
  NpcAttackEvent,
  NpcEvent,
  NyloWaveSpawnEvent,
  NyloWaveStallEvent,
  PlayerAttackEvent,
  PlayerDeathEvent,
  PlayerUpdateEvent,
  SoteMazeEvent,
  SoteMazePathEvent,
  VerzikPhaseEvent,
  XarpusPhaseEvent,
} from '../event';
import { NameChangeModel } from '../models/name-change';
import {
  Coords as CoordsProto,
  Event as EventProto,
  NpcAttackMap,
  PlayerAttackMap,
  StageMap,
} from '../generated/event_pb';
import {
  ChallengeData as ChallengeDataProto,
  ChallengeEvents as ChallengeEventsProto,
} from '../generated/challenge_storage_pb';
import { Npc } from '../npcs/npc-id';

type PersonalBest = {
  type: SplitType;
  scale: number;
  ticks: number;
  splitId: number;
};

type PlayerInfo = {
  id: number;
  totalRecordings: number;
  personalBests: PersonalBest[];
  stats: PlayerStatsRow[];
};

type PlayerStatsRow = {
  player_id: number;
  date: Date;

  tob_completions: number;
  tob_wipes: number;
  tob_resets: number;

  colosseum_completions: number;
  colosseum_wipes: number;
  colosseum_resets: number;

  deaths_total: number;
  deaths_maiden: number;
  deaths_bloat: number;
  deaths_nylocas: number;
  deaths_sotetseg: number;
  deaths_xarpus: number;
  deaths_verzik: number;

  hammer_bops: number;
  bgs_smacks: number;
  chally_pokes: number;
  uncharged_scythe_swings: number;
  ralos_autos: number;
  elder_maul_smacks: number;

  tob_barrages_without_proper_weapon: number;
  tob_verzik_p1_troll_specs: number;
  tob_verzik_p3_melees: number;

  chins_thrown_total: number;
  chins_thrown_black: number;
  chins_thrown_red: number;
  chins_thrown_grey: number;
  chins_thrown_maiden: number;
  chins_thrown_nylocas: number;
  chins_thrown_value: number;
  chins_thrown_incorrectly_maiden: number;
};

function newPlayerStatsRow(
  playerId: number,
  date: Date,
  previous?: PlayerStatsRow,
): PlayerStatsRow {
  if (previous !== undefined) {
    return {
      ...previous,
      date: startOfDateUtc(date),
    };
  }
  return {
    player_id: playerId,
    date: startOfDateUtc(date),
    tob_completions: 0,
    tob_wipes: 0,
    tob_resets: 0,
    colosseum_completions: 0,
    colosseum_wipes: 0,
    colosseum_resets: 0,
    deaths_total: 0,
    deaths_maiden: 0,
    deaths_bloat: 0,
    deaths_nylocas: 0,
    deaths_sotetseg: 0,
    deaths_xarpus: 0,
    deaths_verzik: 0,
    hammer_bops: 0,
    bgs_smacks: 0,
    chally_pokes: 0,
    uncharged_scythe_swings: 0,
    ralos_autos: 0,
    elder_maul_smacks: 0,
    tob_barrages_without_proper_weapon: 0,
    tob_verzik_p1_troll_specs: 0,
    tob_verzik_p3_melees: 0,
    chins_thrown_total: 0,
    chins_thrown_black: 0,
    chins_thrown_red: 0,
    chins_thrown_grey: 0,
    chins_thrown_maiden: 0,
    chins_thrown_nylocas: 0,
    chins_thrown_value: 0,
    chins_thrown_incorrectly_maiden: 0,
  };
}

async function migrateUsers(sql: postgres.Sql): Promise<Map<string, number>> {
  const users = await UserModel.find({}, {}, { sort: { _id: 1 } }).exec();
  const userMap = new Map<string, number>();

  for (const user of users) {
    const users = await sql`
        INSERT INTO users (
          username,
          password,
          email,
          created_at,
          email_verified,
          can_create_api_key
        ) VALUES (
          ${user.username},
          ${user.password},
          ${user.email},
          ${user._id.getTimestamp()},
          ${user.emailVerified || false},
          ${user.canCreateApiKey || false}
        )
        RETURNING id;
    `;

    userMap.set(user._id.toString(), users[0].id);
  }

  return userMap;
}

async function migratePlayers(
  sql: postgres.Sql,
): Promise<Map<string, PlayerInfo>> {
  const players = await PlayerModel.find({}, {}, { sort: { _id: 1 } }).exec();
  const playerMap = new Map<string, PlayerInfo>();

  for (const player of players) {
    const players = await sql`
        INSERT INTO players (username, overall_experience)
        VALUES (${player.formattedUsername}, ${player.overallExperience})
        RETURNING id;
    `;

    playerMap.set(player._id.toString(), {
      id: players[0].id,
      totalRecordings: 0,
      personalBests: [],
      stats: [],
    });
  }

  return playerMap;
}

async function migrateApiKeys(
  sql: postgres.Sql,
  users: Map<string, number>,
  players: Map<string, PlayerInfo>,
) {
  const apiKeys = await ApiKeyModel.find({}, {}, { sort: { _id: 1 } }).exec();

  for (const apiKey of apiKeys) {
    const userId = users.get(apiKey.userId.toString())!;
    const playerId = players.get(apiKey.playerId.toString())!.id;

    await sql`
        INSERT INTO api_keys (user_id, player_id, key, active, last_used)
        VALUES (
          ${userId},
          ${playerId},
          ${apiKey.key},
          ${apiKey.active},
          ${apiKey.lastUsed}
        );
    `;
  }
}

async function migrateNameChanges(
  sql: postgres.Sql,
  users: Map<string, number>,
  players: Map<string, PlayerInfo>,
) {
  const nameChanges = await NameChangeModel.find({}, {}, { sort: { _id: 1 } });

  for (const nameChange of nameChanges) {
    const playerId = players.get(nameChange.playerId.toString())!.id;
    const submitterId =
      nameChange.submitterId !== null
        ? users.get(nameChange.submitterId.toString())!
        : null;

    const submittedAt = nameChange._id.getTimestamp();

    await sql`
        INSERT INTO name_changes (
          player_id,
          submitter_id,
          old_name,
          new_name,
          status,
          submitted_at,
          processed_at,
          migrated_documents
        ) VALUES (
          ${playerId},
          ${submitterId},
          ${nameChange.oldName},
          ${nameChange.newName},
          ${nameChange.status},
          ${submittedAt},
          ${nameChange.processedAt},
          ${nameChange.migratedDocuments}
        );
    `;
  }
}

type Split = {
  name?: string;
  challenge_id: number;
  type: SplitType;
  scale: number;
  ticks: number;
  accurate?: boolean;
};

function getMaidenSplits(raid: OldTobRaid, raidId: number): Split[] {
  const maidenSplits = [];
  const scale = raid.party.length;

  const completedMaiden =
    raid.stage > Stage.TOB_MAIDEN || raid.status === ChallengeStatus.RESET;
  if (raid.tobRooms.maiden !== null) {
    const accurateMaidenData =
      completedMaiden && raid.tobRooms.maiden.firstTick === 0;
    const maidenData = raid.tobRooms.maiden!;
    maidenSplits.push({
      name: 'Maiden room time',
      challenge_id: raidId,
      type: adjustSplitForMode(SplitType.TOB_MAIDEN, raid.mode),
      scale,
      ticks: maidenData.roomTicks,
      accurate: accurateMaidenData,
    });

    if (maidenData.splits.SEVENTIES > 0) {
      maidenSplits.push({
        name: 'Maiden 70s',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_MAIDEN_70S, raid.mode),
        scale,
        ticks: maidenData.splits.SEVENTIES,
        accurate: accurateMaidenData,
      });

      if (maidenData.splits.FIFTIES > 0) {
        maidenSplits.push({
          name: 'Maiden 50s',
          challenge_id: raidId,
          type: adjustSplitForMode(SplitType.TOB_MAIDEN_50S, raid.mode),
          scale,
          ticks: maidenData.splits.FIFTIES,
          accurate: accurateMaidenData,
        });

        maidenSplits.push({
          name: 'Maiden 70s-50s',
          challenge_id: raidId,
          type: adjustSplitForMode(SplitType.TOB_MAIDEN_70S_50S, raid.mode),
          scale,
          ticks: maidenData.splits.FIFTIES - maidenData.splits.SEVENTIES,
          accurate: accurateMaidenData,
        });

        if (maidenData.splits.THIRTIES > 0) {
          maidenSplits.push({
            name: 'Maiden 30s',
            challenge_id: raidId,
            type: adjustSplitForMode(SplitType.TOB_MAIDEN_30S, raid.mode),
            scale,
            ticks: maidenData.splits.THIRTIES,
            accurate: accurateMaidenData,
          });

          maidenSplits.push({
            name: 'Maiden 50s-30s',
            challenge_id: raidId,
            type: adjustSplitForMode(SplitType.TOB_MAIDEN_50S_30S, raid.mode),
            scale,
            ticks: maidenData.splits.THIRTIES - maidenData.splits.FIFTIES,
            accurate: accurateMaidenData,
          });

          maidenSplits.push({
            name: 'Maiden 30s-end',
            challenge_id: raidId,
            type: adjustSplitForMode(SplitType.TOB_MAIDEN_30S_END, raid.mode),
            scale,
            ticks: maidenData.roomTicks - maidenData.splits.THIRTIES,
            accurate: accurateMaidenData,
          });
        }
      }
    }
  }

  return maidenSplits;
}

function getBloatSplits(raid: OldTobRaid, raidId: number): Split[] {
  const bloatSplits = [];
  const scale = raid.party.length;

  const completedBloat =
    raid.stage > Stage.TOB_BLOAT || raid.status === ChallengeStatus.RESET;
  if (raid.tobRooms.bloat !== null) {
    const accurateBloatData =
      completedBloat && raid.tobRooms.bloat.firstTick === 0;
    const bloatData = raid.tobRooms.bloat!;
    bloatSplits.push({
      name: 'Bloat room time',
      challenge_id: raidId,
      type: adjustSplitForMode(SplitType.TOB_BLOAT, raid.mode),
      scale,
      ticks: bloatData.roomTicks,
      accurate: accurateBloatData,
    });
  }

  return bloatSplits;
}

function getNylocasSplits(raid: OldTobRaid, raidId: number): Split[] {
  const nylocasSplits = [];
  const scale = raid.party.length;

  const completedNylocas =
    raid.stage > Stage.TOB_NYLOCAS || raid.status === ChallengeStatus.RESET;
  if (raid.tobRooms.nylocas !== null) {
    const accurateNylocasData =
      completedNylocas && raid.tobRooms.nylocas.firstTick === 0;
    const nylocasData = raid.tobRooms.nylocas!;
    nylocasSplits.push({
      name: 'Nylocas room time',
      challenge_id: raidId,
      type: adjustSplitForMode(SplitType.TOB_NYLO_ROOM, raid.mode),
      scale,
      ticks: nylocasData.roomTicks,
      accurate: accurateNylocasData,
    });

    if (nylocasData.splits.capIncrease > 0) {
      nylocasSplits.push({
        name: 'Nylocas cap increase',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_NYLO_CAP, raid.mode),
        scale,
        ticks: nylocasData.splits.capIncrease,
        accurate: accurateNylocasData,
      });
    }

    if (nylocasData.splits.waves > 0) {
      nylocasSplits.push({
        name: 'Nylocas waves',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_NYLO_WAVES, raid.mode),
        scale,
        ticks: nylocasData.splits.waves,
        accurate: accurateNylocasData,
      });
    }

    if (nylocasData.splits.cleanup > 0) {
      nylocasSplits.push({
        name: 'Nylocas cleanup',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_NYLO_CLEANUP, raid.mode),
        scale,
        ticks: nylocasData.splits.cleanup,
        accurate: accurateNylocasData,
      });
    }

    if (nylocasData.splits.boss > 0) {
      nylocasSplits.push({
        name: 'Nylocas waves',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_NYLO_BOSS_SPAWN, raid.mode),
        scale,
        ticks: nylocasData.splits.boss,
        accurate: accurateNylocasData,
      });

      nylocasSplits.push({
        name: 'Nylocas boss',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_NYLO_BOSS, raid.mode),
        scale,
        ticks: nylocasData.roomTicks - nylocasData.splits.boss,
        accurate: accurateNylocasData,
      });
    }
  }

  return nylocasSplits;
}

function getSotetsegSplits(raid: OldTobRaid, raidId: number): Split[] {
  const sotetsegSplits = [];
  const scale = raid.party.length;

  const completedSotetseg =
    raid.stage > Stage.TOB_SOTETSEG || raid.status === ChallengeStatus.RESET;
  if (raid.tobRooms.sotetseg !== null) {
    const accurateSotetsegData =
      completedSotetseg && raid.tobRooms.sotetseg.firstTick === 0;
    const sotetsegData = raid.tobRooms.sotetseg!;
    sotetsegSplits.push({
      name: 'Sotetseg room time',
      challenge_id: raidId,
      type: adjustSplitForMode(SplitType.TOB_SOTETSEG, raid.mode),
      scale,
      ticks: sotetsegData.roomTicks,
      accurate: accurateSotetsegData,
    });

    if (sotetsegData.splits.MAZE_66 > 0) {
      sotetsegSplits.push({
        name: 'Sotetseg maze 66',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_SOTETSEG_66, raid.mode),
        scale,
        ticks: sotetsegData.splits.MAZE_66,
        accurate: accurateSotetsegData,
      });

      if (sotetsegData.maze66 && sotetsegData.maze66.ticks > 0) {
        sotetsegSplits.push({
          name: 'Sotetseg maze 1',
          challenge_id: raidId,
          type: adjustSplitForMode(SplitType.TOB_SOTETSEG_MAZE_1, raid.mode),
          scale,
          ticks: sotetsegData.maze66.ticks,
          accurate: accurateSotetsegData,
        });
      }

      if (sotetsegData.splits.MAZE_33 > 0) {
        sotetsegSplits.push({
          name: 'Sotetseg maze 33',
          challenge_id: raidId,
          type: adjustSplitForMode(SplitType.TOB_SOTETSEG_33, raid.mode),
          scale,
          ticks: sotetsegData.splits.MAZE_33,
          accurate: accurateSotetsegData,
        });

        if (sotetsegData.maze66 && sotetsegData.maze66.ticks > 0) {
          const maze1End =
            sotetsegData.splits.MAZE_66 + sotetsegData.maze66.ticks;
          sotetsegSplits.push({
            name: 'Sotetseg P2',
            challenge_id: raidId,
            type: adjustSplitForMode(SplitType.TOB_SOTETSEG_P2, raid.mode),
            scale,
            ticks: sotetsegData.splits.MAZE_33 - maze1End,
            accurate: accurateSotetsegData,
          });
        }

        if (sotetsegData.maze33 && sotetsegData.maze33.ticks > 0) {
          sotetsegSplits.push({
            name: 'Sotetseg maze 2',
            challenge_id: raidId,
            type: adjustSplitForMode(SplitType.TOB_SOTETSEG_MAZE_2, raid.mode),
            scale,
            ticks: sotetsegData.maze33.ticks,
            accurate: accurateSotetsegData,
          });

          const maze2End =
            sotetsegData.splits.MAZE_33 + sotetsegData.maze33.ticks;
          sotetsegSplits.push({
            name: 'Sotetseg P3',
            challenge_id: raidId,
            type: adjustSplitForMode(SplitType.TOB_SOTETSEG_P3, raid.mode),
            scale,
            ticks: sotetsegData.roomTicks - maze2End,
            accurate: accurateSotetsegData,
          });
        }
      }
    }
  }

  return sotetsegSplits;
}

function getXarpusSplits(raid: OldTobRaid, raidId: number): Split[] {
  const xarpusSplits = [];
  const scale = raid.party.length;

  const completedXarpus =
    raid.stage > Stage.TOB_XARPUS || raid.status === ChallengeStatus.RESET;
  if (raid.tobRooms.xarpus !== null) {
    const accurateXarpusData =
      completedXarpus && raid.tobRooms.xarpus.firstTick === 0;
    const xarpusData = raid.tobRooms.xarpus!;
    xarpusSplits.push({
      name: 'Xarpus room time',
      challenge_id: raidId,
      type: adjustSplitForMode(SplitType.TOB_XARPUS, raid.mode),
      scale,
      ticks: xarpusData.roomTicks,
      accurate: accurateXarpusData,
    });

    if (xarpusData.splits.exhumes > 0) {
      xarpusSplits.push({
        name: 'Xarpus exhumes',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_XARPUS_EXHUMES, raid.mode),
        scale,
        ticks: xarpusData.splits.exhumes,
        accurate: accurateXarpusData,
      });
    }

    if (xarpusData.splits.screech > 0) {
      xarpusSplits.push({
        name: 'Xarpus screech',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_XARPUS_SCREECH, raid.mode),
        scale,
        ticks: xarpusData.splits.screech,
        accurate: accurateXarpusData,
      });

      xarpusSplits.push({
        name: 'Xarpus P2',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_XARPUS_P2, raid.mode),
        scale,
        ticks: xarpusData.splits.screech - xarpusData.splits.exhumes,
        accurate: accurateXarpusData,
      });

      xarpusSplits.push({
        name: 'Xarpus P3',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_XARPUS_P3, raid.mode),
        scale,
        ticks: xarpusData.roomTicks - xarpusData.splits.screech,
        accurate: accurateXarpusData,
      });
    }
  }

  return xarpusSplits;
}

function getVerzikSplits(raid: OldTobRaid, raidId: number): Split[] {
  const verzikSplits = [];
  const scale = raid.party.length;

  const completedVerzik =
    raid.stage === Stage.TOB_VERZIK &&
    raid.status === ChallengeStatus.COMPLETED;
  if (raid.tobRooms.verzik !== null) {
    const accurateVerzikData =
      completedVerzik && raid.tobRooms.verzik.firstTick === 0;
    const verzikData = raid.tobRooms.verzik!;
    verzikSplits.push({
      name: 'Verzik room time',
      challenge_id: raidId,
      type: adjustSplitForMode(SplitType.TOB_VERZIK_ROOM, raid.mode),
      scale,
      ticks: verzikData.roomTicks,
      accurate: accurateVerzikData,
    });

    if (verzikData.splits.p1 > 0) {
      verzikSplits.push({
        name: 'Verzik P1',
        challenge_id: raidId,
        type: adjustSplitForMode(SplitType.TOB_VERZIK_P1_END, raid.mode),
        scale,
        ticks: verzikData.splits.p1,
        accurate: accurateVerzikData,
      });

      if (verzikData.splits.reds > 0) {
        verzikSplits.push({
          name: 'Verzik reds',
          challenge_id: raidId,
          type: adjustSplitForMode(SplitType.TOB_VERZIK_REDS, raid.mode),
          scale,
          ticks: verzikData.splits.reds,
          accurate: accurateVerzikData,
        });

        if (verzikData.splits.p2 > 0) {
          verzikSplits.push({
            name: 'Verzik P2 end',
            challenge_id: raidId,
            type: adjustSplitForMode(SplitType.TOB_VERZIK_P2_END, raid.mode),
            scale,
            ticks: verzikData.splits.p2,
            accurate: accurateVerzikData,
          });

          verzikSplits.push({
            name: 'Verzik P2',
            challenge_id: raidId,
            type: adjustSplitForMode(SplitType.TOB_VERZIK_P2, raid.mode),
            scale,
            ticks: verzikData.splits.p2 - (verzikData.splits.p1 + 13),
            accurate: accurateVerzikData,
          });

          verzikSplits.push({
            name: 'Verzik P3',
            challenge_id: raidId,
            type: adjustSplitForMode(SplitType.TOB_VERZIK_P3, raid.mode),
            scale,
            ticks: verzikData.roomTicks - (verzikData.splits.p2 + 6),
            accurate: accurateVerzikData,
          });
        }
      }
    }
  }

  return verzikSplits;
}

async function createChallengeSplits(
  sql: postgres.Sql,
  challenge: Raid,
  id: number,
  players: Map<string, PlayerInfo>,
) {
  const splits: Split[] = [];

  if (challenge.type === ChallengeType.TOB) {
    const raid = challenge as OldTobRaid;

    splits.push(...getMaidenSplits(raid, id));
    splits.push(...getBloatSplits(raid, id));
    splits.push(...getNylocasSplits(raid, id));
    splits.push(...getSotetsegSplits(raid, id));
    splits.push(...getXarpusSplits(raid, id));
    splits.push(...getVerzikSplits(raid, id));

    if (raid.status === ChallengeStatus.COMPLETED) {
      splits.push({
        name: 'Challenge',
        challenge_id: id,
        type: adjustSplitForMode(SplitType.TOB_CHALLENGE, raid.mode),
        scale: raid.party.length,
        ticks: raid.totalTicks,
        accurate: true,
      });
    }
  } else if (challenge.type === ChallengeType.COLOSSEUM) {
    const colo = challenge as OldColosseumChallenge;
    splits.push(
      ...colo.colosseum.waves.map((wave, i) => ({
        name: `Wave ${i + 1}`,
        challenge_id: id,
        type: SplitType.COLOSSEUM_WAVE_1 + i,
        scale: 1,
        // @ts-ignore
        ticks: wave.ticks,
        accurate: true,
      })),
    );

    if (
      colo.colosseum.waves.length === 12 &&
      colo.status === ChallengeStatus.COMPLETED
    ) {
      splits.push({
        name: 'Challenge',
        challenge_id: id,
        type: SplitType.COLOSSEUM_CHALLENGE,
        scale: 1,
        ticks: colo.totalTicks,
        accurate: true,
      });
    }
  }

  if (splits.length === 0) {
    return;
  }

  const inserted = await sql`
    INSERT INTO challenge_splits ${sql(
      splits,
      'challenge_id',
      'type',
      'scale',
      'ticks',
      'accurate',
    )}
    RETURNING id;
  `;

  const splitIds = inserted.map((split) => split.id);

  splits.forEach((split, i) => {
    const splitId = splitIds[i];
    console.log(`    ${split.name}: ${split.ticks} [${splitId}]`);

    if (!split.accurate) {
      return;
    }

    challenge.partyIds.forEach((id) => {
      const player = players.get(id.toString())!;

      const currentPb = player.personalBests.find(
        (pb) => pb.type === split.type && pb.scale === split.scale,
      );
      if (!currentPb) {
        player.personalBests.push({
          type: split.type,
          scale: split.scale,
          ticks: split.ticks,
          splitId,
        });
      } else if (split.ticks < currentPb.ticks) {
        currentPb.ticks = split.ticks;
        currentPb.splitId = splitId;
      }
    });
  });
}

async function migrateChallenges(
  sql: postgres.Sql,
  players: Map<string, PlayerInfo>,
): Promise<Map<string, [HydratedDocument<Raid>, number]>> {
  const mongoChallenges = await RaidModel.find(
    {},
    {},
    { sort: { startTime: 1 } },
  ).exec();

  const migratedChallenges: Map<string, [HydratedDocument<Raid>, number]> =
    new Map();
  let skipped = 0;

  for (const challenge of mongoChallenges) {
    if (challenge.status === ChallengeStatus.IN_PROGRESS) {
      console.log(`Skipping in-progress challenge ${challenge._id}`);
      ++skipped;
      continue;
    } else {
      console.log(`Migrating challenge ${challenge._id}`);
    }

    const challenges = await sql`
        INSERT INTO challenges (
            uuid,
            type,
            status,
            stage,
            mode,
            scale,
            start_time,
            challenge_ticks,
            total_deaths
        ) VALUES (
            ${challenge._id},
            ${challenge.type},
            ${challenge.status},
            ${challenge.stage},
            ${challenge.mode},
            ${challenge.party.length},
            ${challenge.startTime},
            ${challenge.totalTicks},
            ${challenge.totalDeaths}
        ) RETURNING id;
    `;

    const challengeId = challenges[0].id;

    const partyMembers = challenge.party.map((player, i) => ({
      challenge_id: challengeId,
      player_id: players.get(challenge.partyIds[i].toString())!.id,
      username: player,
      orb: i,
      primary_gear:
        challenge.partyInfo[i] !== undefined
          ? challenge.partyInfo[i].gear + 1
          : PrimaryMeleeGear.UNKNOWN,
    }));

    await sql`
        INSERT INTO challenge_players ${sql(
          partyMembers,
          'challenge_id',
          'player_id',
          'username',
          'orb',
          'primary_gear',
        )};
    `;

    await createChallengeSplits(sql, challenge, challengeId, players);

    migratedChallenges.set(challenge._id, [challenge, challengeId]);
    challenge.partyIds.forEach((id) => {
      players.get(id.toString())!.totalRecordings++;
    });
  }

  console.log(
    `Migrated ${migratedChallenges.size}, skipped ${skipped} challenges`,
  );
  return migratedChallenges;
}

async function migrateRecordedChallenges(
  sql: postgres.Sql,
  users: Map<string, number>,
  challenges: Map<string, [HydratedDocument<Raid>, number]>,
) {
  const recordings = await RecordedChallengeModel.find(
    {},
    {},
    { sort: { _id: 1 } },
  ).exec();
  let skipped = 0;

  for (const recording of recordings) {
    if (!challenges.has(recording.cId)) {
      ++skipped;
      continue;
    }
    const [, challengeId] = challenges.get(recording.cId)!;

    await sql`
        INSERT INTO recorded_challenges (
            challenge_id,
            recorder_id,
            recording_type
        ) VALUES (
            ${challengeId},
            ${users.get(recording.recorderId.toString())!},
            ${recording.recordingType}
        );
    `;
  }

  console.log(
    `Migrated ${recordings.length - skipped}, skipped ${skipped} recorded challenges`,
  );
}

async function migratePersonalBests(
  sql: postgres.Sql,
  players: Map<string, PlayerInfo>,
) {
  const values = Array.from(players.values());

  for (const player of values) {
    const pbs = player.personalBests.map((pb) => ({
      player_id: player.id,
      challenge_split_id: pb.splitId,
    }));
    if (pbs.length > 0) {
      await sql`
        INSERT INTO personal_bests ${sql(pbs, 'player_id', 'challenge_split_id')};
      `;
    }
  }
}

type QueryableEvent = {
  _id: Types.ObjectId;
  challenge_id: number;
  event_type: number;
  stage: Stage;
  mode: ChallengeMode;
  tick: number;
  x_coord: number;
  y_coord: number;
  subtype: number | null;
  player_id: number | null;
  npc_id: number | null;
  custom_int_1: number | null;
  custom_int_2: number | null;
  custom_short_1: number | null;
  custom_short_2: number | null;
};

function getBasicEventFields(
  challenge: Raid,
  challengeId: number,
  event: HydratedDocument<Event>,
): QueryableEvent {
  return {
    _id: event._id,
    challenge_id: challengeId,
    event_type: event.type,
    stage: event.stage,
    mode: challenge.mode,
    tick: event.tick,
    x_coord: event.xCoord,
    y_coord: event.yCoord,
    subtype: null,
    player_id: null,
    npc_id: null,
    custom_int_1: null,
    custom_int_2: null,
    custom_short_1: null,
    custom_short_2: null,
  };
}

function assumeBloatDownNumber(tick: number): number {
  if (tick < 60) {
    return 1;
  }
  if (tick < 150) {
    return 2;
  }
  if (tick < 210) {
    return 3;
  }
  if (tick < 275) {
    return 4;
  }
  if (tick < 350) {
    return 5;
  }
  if (tick < 420) {
    return 6;
  }
  if (tick < 500) {
    return 7;
  }
  return 8;
}

function npcsForStage(challenge: Raid, stage: Stage): Map<string, RoomNpc> {
  if (challenge.type === ChallengeType.TOB) {
    const raid = challenge as OldTobRaid;
    switch (stage) {
      case Stage.TOB_MAIDEN:
        if (!raid.tobRooms.maiden) {
          return new Map();
        }
        return raid.tobRooms.maiden.npcs as unknown as Map<string, RoomNpc>;
      case Stage.TOB_BLOAT:
        if (!raid.tobRooms.bloat) {
          return new Map();
        }
        return raid.tobRooms.bloat.npcs as unknown as Map<string, RoomNpc>;
      case Stage.TOB_NYLOCAS:
        if (!raid.tobRooms.nylocas) {
          return new Map();
        }
        return raid.tobRooms.nylocas.npcs as unknown as Map<string, RoomNpc>;
      case Stage.TOB_SOTETSEG:
        if (!raid.tobRooms.sotetseg) {
          return new Map();
        }
        return raid.tobRooms.sotetseg.npcs as unknown as Map<string, RoomNpc>;
      case Stage.TOB_XARPUS:
        if (!raid.tobRooms.xarpus) {
          return new Map();
        }
        return raid.tobRooms.xarpus.npcs as unknown as Map<string, RoomNpc>;
      case Stage.TOB_VERZIK:
        if (!raid.tobRooms.verzik) {
          return new Map();
        }
        return raid.tobRooms.verzik.npcs as unknown as Map<string, RoomNpc>;
    }
  } else {
    const colo = challenge as OldColosseumChallenge;
    return colo.colosseum.waves[stage - Stage.COLOSSEUM_WAVE_1]
      .npcs as unknown as Map<string, RoomNpc>;
  }

  return new Map();
}

function startOfDateUtc(date: Date = new Date()): Date {
  date.setUTCHours(0);
  date.setUTCMinutes(0);
  date.setUTCSeconds(0);
  date.setUTCMilliseconds(0);
  return date;
}

function updateStatsForPlayerAttack(
  event: PlayerAttackEvent,
  stats: PlayerStatsRow,
  npcs: Map<string, RoomNpc>,
): void {
  function isNyloOrTickFix(target?: BasicEventNpc): boolean {
    if (!target) {
      return false;
    }

    if (Npc.isVerzikMatomenos(target.id)) {
      return true;
    }

    const roomNpc = npcs.get(target.roomId.toString());
    if (roomNpc !== undefined && roomNpc.type === RoomNpcType.NYLO) {
      const nylo = roomNpc as Nylo;
      return nylo.nylo.wave > 26;
    }

    return false;
  }

  switch (event.attack.type) {
    case PlayerAttack.HAMMER_BOP:
      if (!isNyloOrTickFix(event.attack.target)) {
        stats.hammer_bops++;
      }
      break;

    case PlayerAttack.GODSWORD_SMACK:
      if (!isNyloOrTickFix(event.attack.target)) {
        stats.bgs_smacks++;
      }
      break;

    case PlayerAttack.CHALLY_SWIPE:
      if (!isNyloOrTickFix(event.attack.target)) {
        stats.chally_pokes++;
      }
      break;

    case PlayerAttack.ELDER_MAUL:
      if (!isNyloOrTickFix(event.attack.target)) {
        stats.elder_maul_smacks++;
      }
      break;

    case PlayerAttack.SCYTHE_UNCHARGED:
      stats.uncharged_scythe_swings++;
      break;

    case PlayerAttack.TONALZTICS_AUTO:
      if (!isNyloOrTickFix(event.attack.target)) {
        stats.ralos_autos++;
      }
      break;

    case PlayerAttack.SANG_BARRAGE:
    case PlayerAttack.SHADOW_BARRAGE:
    case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
    case PlayerAttack.TRIDENT_BARRAGE:
    case PlayerAttack.UNKNOWN_BARRAGE:
      stats.tob_barrages_without_proper_weapon++;
      break;

    case PlayerAttack.CLAW_SPEC:
    case PlayerAttack.BGS_SPEC:
    case PlayerAttack.DINHS_SPEC:
    case PlayerAttack.CHALLY_SPEC:
    case PlayerAttack.HAMMER_SPEC:
    case PlayerAttack.VOIDWAKER_SPEC:
    case PlayerAttack.ELDER_MAUL_SPEC:
    case PlayerAttack.TONALZTICS_SPEC:
    case PlayerAttack.VOLATILE_NM_SPEC:
      if (event.attack.target && Npc.isVerzikP1(event.attack.target.id)) {
        stats.tob_verzik_p1_troll_specs++;
      }
      break;

    case PlayerAttack.CHIN_BLACK:
    case PlayerAttack.CHIN_GREY:
    case PlayerAttack.CHIN_RED:
      const isWrongThrowDistance =
        event.attack.distanceToTarget !== -1 &&
        (event.attack.distanceToTarget < 4 ||
          event.attack.distanceToTarget > 6);

      stats.chins_thrown_total += 1;

      if (event.stage === Stage.TOB_MAIDEN) {
        stats.chins_thrown_maiden += 1;
      } else if (event.stage === Stage.TOB_NYLOCAS) {
        stats.chins_thrown_nylocas += 1;
      }

      if (event.attack.type === PlayerAttack.CHIN_BLACK) {
        stats.chins_thrown_black += 1;
      } else if (event.attack.type === PlayerAttack.CHIN_RED) {
        stats.chins_thrown_red += 1;
      } else if (event.attack.type === PlayerAttack.CHIN_GREY) {
        stats.chins_thrown_grey += 1;
      }

      if (event.attack.target !== undefined && isWrongThrowDistance) {
        if (Npc.isMaidenMatomenos(event.attack.target.id)) {
          stats.chins_thrown_incorrectly_maiden += 1;
        }
      }
      break;
  }
}

async function migrateRoomEvents(
  sql: postgres.Sql,
  challenges: Map<string, [HydratedDocument<Raid>, number]>,
  players: Map<string, PlayerInfo>,
) {
  let totalEventsMigrated = 0;
  let eventsSkipped = 0;
  let i = 0;

  for (const [challenge, challengeId] of challenges.values()) {
    ++i;

    const statsForPlayer: Record<string, PlayerStatsRow> = {};

    const partyIndex: Record<string, number> = {};
    challenge.party.forEach((name, i) => {
      partyIndex[name] = i;

      const player = players.get(challenge.partyIds[i].toString())!;
      const statsForDay = player.stats.find(
        (s) =>
          s.date.getTime() === startOfDateUtc(challenge.startTime).getTime(),
      );
      if (statsForDay !== undefined) {
        statsForPlayer[name.toLowerCase()] = statsForDay;
      } else {
        const previousStats =
          player.stats.length > 0
            ? player.stats[player.stats.length - 1]
            : undefined;
        const stats = newPlayerStatsRow(
          player.id,
          challenge.startTime,
          previousStats,
        );
        player.stats.push(stats);
        statsForPlayer[name.toLowerCase()] = stats;
      }

      switch (challenge.status) {
        case ChallengeStatus.COMPLETED:
          if (challenge.type === ChallengeType.TOB) {
            statsForPlayer[name.toLowerCase()].tob_completions++;
          } else {
            statsForPlayer[name.toLowerCase()].colosseum_completions++;
          }
          break;
        case ChallengeStatus.RESET:
          if (challenge.type === ChallengeType.TOB) {
            statsForPlayer[name.toLowerCase()].tob_resets++;
          } else {
            statsForPlayer[name.toLowerCase()].colosseum_resets++;
          }
          break;
        case ChallengeStatus.WIPED:
          if (challenge.type === ChallengeType.TOB) {
            statsForPlayer[name.toLowerCase()].tob_wipes++;
          } else {
            statsForPlayer[name.toLowerCase()].colosseum_wipes++;
          }
          break;
      }
    });

    const getPlayerId = (username: string): number | null => {
      const index = challenge.party.indexOf(username);
      if (index === -1) {
        return null;
      }
      const oid = challenge.partyIds[index];
      return players.get(oid.toString())!.id;
    };

    const getNpcId = (
      npcId: number,
      roomId: number,
      stage: Stage,
    ): number | null => {
      if (npcId >= 0 && npcId < Math.pow(2, 15)) {
        return npcId;
      }

      const npcs = npcsForStage(challenge, stage);
      return npcs.get(roomId.toString())?.spawnNpcId ?? null;
    };

    const roomEvents = await RoomEvent.find({
      cId: challenge._id,
    }).exec();

    const queryableEvents: QueryableEvent[] = [];

    const protoChallengeEvents = new Map<Stage, EventProto[]>();

    for (const event of roomEvents) {
      let evt = null;

      switch (event.type) {
        case EventType.PLAYER_ATTACK: {
          const e = event as PlayerAttackEvent;
          evt = getBasicEventFields(challenge, challengeId, event);
          evt.player_id = getPlayerId(event.player.name);
          evt.subtype = e.attack.type;
          if (e.attack.target) {
            evt.npc_id = e.attack.target.id;
          }
          if (e.attack.weapon && e.attack.weapon.id) {
            evt[QueryableEventField.PLAYER_ATTACK_WEAPON] = e.attack.weapon.id;
          }
          evt[QueryableEventField.PLAYER_ATTACK_DISTANCE] =
            e.attack.distanceToTarget;

          if (e.player.name) {
            updateStatsForPlayerAttack(
              e,
              statsForPlayer[e.player.name.toLowerCase()],
              npcsForStage(challenge, event.stage),
            );
          }
          break;
        }

        case EventType.PLAYER_DEATH: {
          evt = getBasicEventFields(challenge, challengeId, event);
          evt.player_id = getPlayerId(event.player.name);

          const name = event.player.name.toLowerCase();
          statsForPlayer[name].deaths_total++;
          switch (event.stage) {
            case Stage.TOB_MAIDEN:
              statsForPlayer[name].deaths_maiden++;
              break;
            case Stage.TOB_BLOAT:
              statsForPlayer[name].deaths_bloat++;
              break;
            case Stage.TOB_NYLOCAS:
              statsForPlayer[name].deaths_nylocas++;
              break;
            case Stage.TOB_SOTETSEG:
              statsForPlayer[name].deaths_sotetseg++;
              break;
            case Stage.TOB_XARPUS:
              statsForPlayer[name].deaths_xarpus++;
              break;
            case Stage.TOB_VERZIK:
              statsForPlayer[name].deaths_verzik++;
              break;
          }

          break;
        }

        case EventType.NPC_SPAWN: {
          const e = event as NpcEvent;
          evt = getBasicEventFields(challenge, challengeId, event);
          evt.npc_id = e.npc.id;
          break;
        }

        case EventType.NPC_DEATH: {
          const e = event as NpcEvent;
          evt = getBasicEventFields(challenge, challengeId, event);
          evt.npc_id = getNpcId(e.npc.id, e.npc.roomId, event.stage);
          break;
        }

        case EventType.NPC_ATTACK: {
          const e = event as NpcAttackEvent;
          evt = getBasicEventFields(challenge, challengeId, event);
          evt.subtype = e.npcAttack.attack;
          evt.npc_id = getNpcId(e.npc.id, e.npc.roomId, event.stage);
          if (e.npcAttack.target) {
            evt.player_id = getPlayerId(e.npcAttack.target);

            if (e.npcAttack.attack === NpcAttack.TOB_VERZIK_P3_MELEE) {
              statsForPlayer[e.npcAttack.target.toLowerCase()]
                .tob_verzik_p3_melees++;
            }
          }
          break;
        }

        case EventType.TOB_MAIDEN_CRAB_LEAK: {
          const e = event as NpcEvent;
          const hitpoints = SkillLevel.fromRaw(e.npc.hitpoints);
          evt = getBasicEventFields(challenge, challengeId, event);
          evt.npc_id = e.npc.id;
          const roomNpc = npcsForStage(challenge, event.stage).get(
            e.npc.roomId.toString(),
          );
          if (roomNpc && roomNpc.type === RoomNpcType.MAIDEN_CRAB) {
            const maidenCrab = (roomNpc as MaidenCrab).maidenCrab;
            evt[QueryableEventField.TOB_MAIDEN_CRAB_LEAK_SPAWN] =
              maidenCrab.spawn;
            evt[QueryableEventField.TOB_MAIDEN_CRAB_LEAK_POSITION] =
              maidenCrab.position;
          }
          evt[QueryableEventField.TOB_MAIDEN_CRAB_LEAK_CURRENT_HP] =
            hitpoints.getCurrent();
          evt[QueryableEventField.TOB_MAIDEN_CRAB_LEAK_BASE_HP] =
            hitpoints.getBase();
          break;
        }

        case EventType.TOB_BLOAT_DOWN: {
          const e = event as BloatDownEvent;
          evt = getBasicEventFields(challenge, challengeId, event);
          if (e.bloatDown.downNumber) {
            evt[QueryableEventField.TOB_BLOAT_DOWN_NUMBER] =
              e.bloatDown.downNumber;
          } else {
            evt[QueryableEventField.TOB_BLOAT_DOWN_NUMBER] =
              assumeBloatDownNumber(e.tick);
          }
          evt[QueryableEventField.TOB_BLOAT_DOWN_WALK_TIME] =
            e.bloatDown.walkTime;
          break;
        }

        case EventType.TOB_NYLO_WAVE_STALL: {
          const e = event as NyloWaveStallEvent;
          evt = getBasicEventFields(challenge, challengeId, event);
          evt[QueryableEventField.TOB_NYLO_WAVE_NUMBER] = e.nyloWave.wave;
          evt[QueryableEventField.TOB_NYLO_WAVE_NYLO_COUNT] =
            e.nyloWave.nylosAlive;
          break;
        }

        case EventType.CHALLENGE_START:
        case EventType.CHALLENGE_END:
        case EventType.CHALLENGE_UPDATE:
        case EventType.STAGE_UPDATE:
        case EventType.PLAYER_UPDATE:
        case EventType.NPC_UPDATE:
        case EventType.TOB_MAIDEN_BLOOD_SPLATS:
        case EventType.TOB_BLOAT_UP:
        case EventType.TOB_NYLO_WAVE_SPAWN:
        case EventType.TOB_NYLO_CLEANUP_END:
        case EventType.TOB_NYLO_BOSS_SPAWN:
        case EventType.TOB_SOTE_MAZE_PROC:
        case EventType.TOB_SOTE_MAZE_PATH:
        case EventType.TOB_SOTE_MAZE_END:
        case EventType.TOB_XARPUS_PHASE:
        case EventType.TOB_VERZIK_PHASE:
        case EventType.TOB_VERZIK_ATTACK_STYLE:
        case EventType.COLOSSEUM_HANDICAP_CHOICE:
          // Not written to the database.
          ++eventsSkipped;
          break;
      }

      if (event.acc && evt !== null) {
        queryableEvents.push(evt);
      }

      if (!protoChallengeEvents.has(event.stage)) {
        protoChallengeEvents.set(event.stage, []);
      }
      protoChallengeEvents
        .get(event.stage)!
        .push(buildEventProto(event, partyIndex, getNpcId));
    }

    const broken = queryableEvents.find((evt) => {
      if (
        Object.keys(evt).some(
          (key) => evt[key as keyof QueryableEvent] === undefined,
        )
      ) {
        return true;
      }

      if (evt.npc_id !== null && evt.npc_id >= Math.pow(2, 31)) {
        return true;
      }
      if (evt.custom_int_1 !== null && evt.custom_int_1 >= Math.pow(2, 31)) {
        return true;
      }
      if (evt.custom_int_2 !== null && evt.custom_int_2 >= Math.pow(2, 31)) {
        return true;
      }
      if (
        evt.custom_short_1 !== null &&
        evt.custom_short_1 >= Math.pow(2, 15)
      ) {
        return true;
      }
      if (
        evt.custom_short_2 !== null &&
        evt.custom_short_2 >= Math.pow(2, 15)
      ) {
        return true;
      }

      return false;
    });
    if (broken) {
      const original = await RoomEvent.findById(broken._id).lean().exec();
      console.error('Broken event', broken, original);
      throw new Error('Broken event');
    }

    if (queryableEvents.length > 0) {
      await sql`
        INSERT INTO queryable_events ${sql(
          queryableEvents,
          'challenge_id',
          'event_type',
          'stage',
          'mode',
          'tick',
          'x_coord',
          'y_coord',
          'subtype',
          'player_id',
          'npc_id',
          'custom_int_1',
          'custom_int_2',
          'custom_short_1',
          'custom_short_2',
        )};
      `;
    }

    const subdir = challenge._id.toString().slice(0, 2);
    const uuid = challenge._id.toString().replaceAll('-', '');
    const challengeDir = `${process.env.BLERT_OUT_DIR}/${subdir}/${uuid}`;
    await mkdir(challengeDir, { recursive: true });

    const challengeProto = buildChallengeProto(challenge);
    await writeFile(
      `${challengeDir}/challenge`,
      challengeProto.serializeBinary(),
    );

    const entries = Array.from(protoChallengeEvents.entries());
    for (const [stage, evts] of entries) {
      let filename;
      switch (stage) {
        case Stage.TOB_MAIDEN:
          filename = 'maiden';
          break;
        case Stage.TOB_BLOAT:
          filename = 'bloat';
          break;
        case Stage.TOB_NYLOCAS:
          filename = 'nylocas';
          break;
        case Stage.TOB_SOTETSEG:
          filename = 'sotetseg';
          break;
        case Stage.TOB_XARPUS:
          filename = 'xarpus';
          break;
        case Stage.TOB_VERZIK:
          filename = 'verzik';
          break;
        case Stage.COLOSSEUM_WAVE_1:
        case Stage.COLOSSEUM_WAVE_2:
        case Stage.COLOSSEUM_WAVE_3:
        case Stage.COLOSSEUM_WAVE_4:
        case Stage.COLOSSEUM_WAVE_5:
        case Stage.COLOSSEUM_WAVE_6:
        case Stage.COLOSSEUM_WAVE_7:
        case Stage.COLOSSEUM_WAVE_8:
        case Stage.COLOSSEUM_WAVE_9:
        case Stage.COLOSSEUM_WAVE_10:
        case Stage.COLOSSEUM_WAVE_11:
        case Stage.COLOSSEUM_WAVE_12:
          filename = `wave-${stage - Stage.COLOSSEUM_WAVE_1 + 1}`;
          break;
      }

      const eventsProto = new ChallengeEventsProto();
      eventsProto.setStage(stage as Proto<StageMap>);
      eventsProto.setPartyNamesList(challenge.party);
      eventsProto.setEventsList(evts);

      await writeFile(
        `${challengeDir}/${filename}`,
        eventsProto.serializeBinary(),
      );
    }

    totalEventsMigrated += queryableEvents.length;
    console.log(
      `Migrated ${queryableEvents.length} events for challenge ${challenge._id} [${i}/${challenges.size}]`,
    );
  }

  console.log(
    `Migrated ${totalEventsMigrated}, skipped ${eventsSkipped} total events`,
  );
}

async function migratePlayerStats(
  sql: postgres.Sql,
  players: Map<string, PlayerInfo>,
) {
  const playerStats = await PlayerStatsModel.find({}).exec();

  playerStats.forEach((stats) => {
    const player = players.get(stats.playerId.toString());
    if (player === undefined) {
      return;
    }
    const statsForDay = player.stats.find(
      (s) => s.date.getTime() === stats.date.getTime(),
    );
    if (statsForDay !== undefined) {
      statsForDay.chins_thrown_value = stats.chinsThrownValue;
    }
  });

  const allPlayers = Array.from(players.values());
  for (const player of allPlayers) {
    if (player.stats.length > 0) {
      await sql`INSERT INTO player_stats ${sql(player.stats)}`;
    }
  }
}

type Proto<E> = E[keyof E];

function buildStageNpcsProto(
  npcs: Map<string, RoomNpc>,
): ChallengeDataProto.StageNpc[] {
  const stageNpcs: ChallengeDataProto.StageNpc[] = [];

  npcs.forEach((npc) => {
    const protoNpc = new ChallengeDataProto.StageNpc();
    protoNpc.setSpawnNpcId(npc.spawnNpcId);
    protoNpc.setRoomId(npc.roomId);
    protoNpc.setSpawnTick(npc.spawnTick);
    protoNpc.setDeathTick(npc.deathTick);

    const spawnPoint = new CoordsProto();
    spawnPoint.setX(npc.spawnPoint.x);
    spawnPoint.setY(npc.spawnPoint.y);
    protoNpc.setSpawnPoint(spawnPoint);
    const deathPoint = new CoordsProto();
    deathPoint.setX(npc.deathPoint.x);
    deathPoint.setY(npc.deathPoint.y);
    protoNpc.setDeathPoint(deathPoint);

    switch (npc.type) {
      case RoomNpcType.BASIC:
        protoNpc.setBasic(new EmptyProto());
        break;
      case RoomNpcType.MAIDEN_CRAB: {
        const crab = (npc as MaidenCrab).maidenCrab;
        const maidenCrab = new EventProto.Npc.MaidenCrab();
        maidenCrab.setSpawn(
          crab.spawn as Proto<EventProto.Npc.MaidenCrab.SpawnMap>,
        );
        maidenCrab.setPosition(
          crab.position as Proto<EventProto.Npc.MaidenCrab.PositionMap>,
        );
        maidenCrab.setScuffed(crab.scuffed);
        protoNpc.setMaidenCrab(maidenCrab);
        break;
      }
      case RoomNpcType.NYLO: {
        const nylo = (npc as Nylo).nylo;
        const nyloProto = new EventProto.Npc.Nylo();
        nyloProto.setWave(nylo.wave);
        nyloProto.setParentRoomId(nylo.parentRoomId);
        nyloProto.setBig(nylo.big);
        nyloProto.setStyle(nylo.style as Proto<EventProto.Npc.Nylo.StyleMap>);
        nyloProto.setSpawnType(
          nylo.spawnType as Proto<EventProto.Npc.Nylo.SpawnTypeMap>,
        );
        protoNpc.setNylo(nyloProto);
        break;
      }
      case RoomNpcType.VERZIK_CRAB: {
        const crab = (npc as VerzikCrab).verzikCrab;
        const verzikCrab = new EventProto.Npc.VerzikCrab();
        verzikCrab.setPhase(crab.phase as Proto<EventProto.VerzikPhaseMap>);
        verzikCrab.setSpawn(
          crab.spawn as Proto<EventProto.Npc.VerzikCrab.SpawnMap>,
        );
        break;
      }
    }

    stageNpcs.push(protoNpc);
  });

  return stageNpcs;
}

function buildChallengeProto(challenge: Raid): ChallengeDataProto {
  const proto = new ChallengeDataProto();

  proto.setChallengeId(challenge._id.toString());

  if (challenge.type === ChallengeType.TOB) {
    const raid = challenge as OldTobRaid;
    const tobRooms = new ChallengeDataProto.TobRooms();

    if (raid.tobRooms.maiden !== null) {
      const maiden = new ChallengeDataProto.TobRoom();
      maiden.setStage(Stage.TOB_MAIDEN as Proto<StageMap>);
      maiden.setTicksLost(raid.tobRooms.maiden.firstTick);
      maiden.setDeathsList(raid.tobRooms.maiden.deaths);
      maiden.setNpcsList(buildStageNpcsProto(raid.tobRooms.maiden.npcs as any));
      tobRooms.setMaiden(maiden);
    }
    if (raid.tobRooms.bloat !== null) {
      const bloat = new ChallengeDataProto.TobRoom();
      bloat.setStage(Stage.TOB_BLOAT as Proto<StageMap>);
      bloat.setTicksLost(raid.tobRooms.bloat.firstTick);
      bloat.setDeathsList(raid.tobRooms.bloat.deaths);
      bloat.setNpcsList(buildStageNpcsProto(raid.tobRooms.bloat.npcs as any));
      bloat.setBloatDownTicksList(raid.tobRooms.bloat.splits.downTicks);
      tobRooms.setBloat(bloat);
    }
    if (raid.tobRooms.nylocas !== null) {
      const nylocas = new ChallengeDataProto.TobRoom();
      nylocas.setStage(Stage.TOB_NYLOCAS as Proto<StageMap>);
      nylocas.setTicksLost(raid.tobRooms.nylocas.firstTick);
      nylocas.setDeathsList(raid.tobRooms.nylocas.deaths);
      nylocas.setNpcsList(
        buildStageNpcsProto(raid.tobRooms.nylocas.npcs as any),
      );
      nylocas.setNyloWavesStalledList(raid.tobRooms.nylocas.stalledWaves);
      tobRooms.setNylocas(nylocas);
    }
    if (raid.tobRooms.sotetseg !== null) {
      const sotetseg = new ChallengeDataProto.TobRoom();
      sotetseg.setStage(Stage.TOB_SOTETSEG as Proto<StageMap>);
      sotetseg.setTicksLost(raid.tobRooms.sotetseg.firstTick);
      sotetseg.setDeathsList(raid.tobRooms.sotetseg.deaths);
      sotetseg.setNpcsList(
        buildStageNpcsProto(raid.tobRooms.sotetseg.npcs as any),
      );
      if (raid.tobRooms.sotetseg.maze66) {
        sotetseg.setSotetsegMaze1PivotsList(
          raid.tobRooms.sotetseg.maze66.pivots,
        );
      }
      if (raid.tobRooms.sotetseg.maze33) {
        sotetseg.setSotetsegMaze2PivotsList(
          raid.tobRooms.sotetseg.maze33.pivots,
        );
      }
      tobRooms.setSotetseg(sotetseg);
    }
    if (raid.tobRooms.xarpus !== null) {
      const xarpus = new ChallengeDataProto.TobRoom();
      xarpus.setStage(Stage.TOB_XARPUS as Proto<StageMap>);
      xarpus.setTicksLost(raid.tobRooms.xarpus.firstTick);
      xarpus.setDeathsList(raid.tobRooms.xarpus.deaths);
      xarpus.setNpcsList(buildStageNpcsProto(raid.tobRooms.xarpus.npcs as any));
      tobRooms.setXarpus(xarpus);
    }
    if (raid.tobRooms.verzik !== null) {
      const verzik = new ChallengeDataProto.TobRoom();
      verzik.setStage(Stage.TOB_VERZIK as Proto<StageMap>);
      verzik.setTicksLost(raid.tobRooms.verzik.firstTick);
      verzik.setDeathsList(raid.tobRooms.verzik.deaths);
      verzik.setNpcsList(buildStageNpcsProto(raid.tobRooms.verzik.npcs as any));
      verzik.setVerzikRedsCount(raid.tobRooms.verzik.redCrabSpawns);
      tobRooms.setVerzik(verzik);
    }

    proto.setTobRooms(tobRooms);
  } else {
    const colo = challenge as OldColosseumChallenge;
    const colosseum = new ChallengeDataProto.Colosseum();
    colosseum.setAllHandicapsList(colo.colosseum.handicaps);
    colo.colosseum.waves.forEach((waveData, i) => {
      const wave = new ChallengeDataProto.ColosseumWave();
      wave.setStage((Stage.COLOSSEUM_WAVE_1 + i) as Proto<StageMap>);
      wave.setTicksLost(0);
      wave.setHandicapChosen(waveData.handicap);
      wave.setHandicapOptionsList(waveData.options);
      wave.setNpcsList(buildStageNpcsProto(waveData.npcs as any));
      colosseum.addWaves(wave);
    });
    proto.setColosseum(colosseum);
  }

  return proto;
}

function buildEventProto(
  event: Event,
  partyIndex: Record<string, number>,
  getNpcId: (npcId: number, roomId: number, stage: Stage) => number | null,
): EventProto {
  const proto = new EventProto();
  proto.setType(event.type as Proto<EventProto.TypeMap>);
  proto.setXCoord(event.xCoord);
  proto.setYCoord(event.yCoord);
  proto.setTick(event.tick);

  switch (event.type) {
    case EventType.PLAYER_UPDATE: {
      const e = event as PlayerUpdateEvent;
      const player = new EventProto.Player();
      player.setPartyIndex(partyIndex[e.player.name]);
      player.setOffCooldownTick(e.player.offCooldownTick);
      if (e.player.hitpoints !== undefined) {
        player.setHitpoints(e.player.hitpoints);
      }
      if (e.player.prayer !== undefined) {
        player.setPrayer(e.player.prayer);
      }
      if (e.player.attack !== undefined) {
        player.setAttack(e.player.attack);
      }
      if (e.player.strength !== undefined) {
        player.setStrength(e.player.strength);
      }
      if (e.player.defence !== undefined) {
        player.setDefence(e.player.defence);
      }
      if (e.player.ranged !== undefined) {
        player.setRanged(e.player.ranged);
      }
      if (e.player.magic !== undefined) {
        player.setMagic(e.player.magic);
      }
      if (e.player.equipmentDeltas) {
        player.setEquipmentDeltasList(e.player.equipmentDeltas);
      }
      player.setActivePrayers(e.player.prayerSet);
      player.setDataSource(e.player.source as 0 | 1);
      proto.setPlayer(player);
      break;
    }

    case EventType.PLAYER_ATTACK: {
      const e = event as PlayerAttackEvent;
      const player = new EventProto.Player();
      player.setPartyIndex(partyIndex[e.player.name]);
      proto.setPlayer(player);
      const attack = new EventProto.Attack();
      attack.setType(e.attack.type as Proto<PlayerAttackMap>);
      attack.setDistanceToTarget(e.attack.distanceToTarget);
      if (e.attack.weapon) {
        const weapon = new EventProto.Player.EquippedItem();
        weapon.setSlot(EventProto.Player.EquipmentSlot.WEAPON);
        weapon.setId(e.attack.weapon.id);
        weapon.setQuantity(e.attack.weapon.quantity);
        attack.setWeapon(weapon);
      }
      if (e.attack.target) {
        const target = new EventProto.Npc();
        try {
          const npcId =
            getNpcId(e.attack.target.id, e.attack.target.roomId, event.stage) ??
            0;
          target.setId(npcId);
        } catch (err) {
          console.log(e);
          throw new Error('Failed to get npcId');
        }
        target.setRoomId(e.attack.target.roomId);
        attack.setTarget(target);
      }
      proto.setPlayerAttack(attack);
      break;
    }

    case EventType.PLAYER_DEATH: {
      const e = event as PlayerDeathEvent;
      const player = new EventProto.Player();
      player.setPartyIndex(partyIndex[e.player.name]);
      proto.setPlayer(player);
      break;
    }

    case EventType.NPC_SPAWN:
    case EventType.NPC_DEATH:
    case EventType.NPC_UPDATE: {
      const e = event as NpcEvent;
      const npc = new EventProto.Npc();
      const npcId = getNpcId(e.npc.id, e.npc.roomId, event.stage) ?? 0;
      npc.setId(npcId);
      npc.setRoomId(e.npc.roomId);
      npc.setHitpoints(e.npc.hitpoints);
      proto.setNpc(npc);
      break;
    }

    case EventType.NPC_ATTACK: {
      const e = event as NpcAttackEvent;

      const npc = new EventProto.Npc();
      const npcId = getNpcId(e.npc.id, e.npc.roomId, event.stage) ?? 0;
      npc.setId(npcId);
      npc.setRoomId(e.npc.roomId);
      proto.setNpc(npc);

      const npcAttack = new EventProto.NpcAttacked();
      npcAttack.setAttack(e.npcAttack.attack as Proto<NpcAttackMap>);
      proto.setNpcAttack(npcAttack);

      if (e.npcAttack.target) {
        const player = new EventProto.Player();
        player.setPartyIndex(partyIndex[e.npcAttack.target]);
        proto.setPlayer(player);
      }
      break;
    }

    case EventType.TOB_MAIDEN_CRAB_LEAK: {
      const e = event as NpcEvent;
      const npc = new EventProto.Npc();
      const npcId = getNpcId(e.npc.id, e.npc.roomId, event.stage) ?? 0;
      npc.setId(npcId);
      npc.setRoomId(e.npc.roomId);
      npc.setHitpoints(e.npc.hitpoints);
      proto.setNpc(npc);
      break;
    }

    case EventType.TOB_MAIDEN_BLOOD_SPLATS: {
      const e = event as MaidenBloodSplatsEvent;
      const splats = e.maidenBloodSplats.map((splat) => {
        const coords = new CoordsProto();
        coords.setX(splat.x);
        coords.setY(splat.y);
        return coords;
      });
      proto.setMaidenBloodSplatsList(splats);
      break;
    }

    case EventType.TOB_BLOAT_DOWN: {
      const e = event as BloatDownEvent;
      const bloatDown = new EventProto.BloatDown();
      if (e.bloatDown.downNumber === undefined) {
        bloatDown.setDownNumber(assumeBloatDownNumber(e.tick));
      } else {
        bloatDown.setDownNumber(e.bloatDown.downNumber);
      }
      bloatDown.setWalkTime(e.bloatDown.walkTime);
      proto.setBloatDown(bloatDown);
      break;
    }

    case EventType.TOB_NYLO_WAVE_SPAWN:
    case EventType.TOB_NYLO_WAVE_STALL: {
      const e = event as NyloWaveStallEvent | NyloWaveSpawnEvent;
      const nyloWave = new EventProto.NyloWave();
      nyloWave.setWave(e.nyloWave.wave);
      nyloWave.setNylosAlive(e.nyloWave.nylosAlive);
      nyloWave.setRoomCap(e.nyloWave.roomCap);
      proto.setNyloWave(nyloWave);
      break;
    }

    case EventType.TOB_NYLO_CLEANUP_END:
    case EventType.TOB_NYLO_BOSS_SPAWN:
      // No extra data.
      break;

    case EventType.TOB_SOTE_MAZE_PROC:
    case EventType.TOB_SOTE_MAZE_END: {
      const e = event as SoteMazeEvent;
      const maze = new EventProto.SoteMaze();
      maze.setMaze(e.soteMaze.maze as Proto<EventProto.SoteMaze.MazeMap>);
      proto.setSoteMaze(maze);
      break;
    }

    case EventType.TOB_SOTE_MAZE_PATH: {
      const e = event as SoteMazePathEvent;
      const maze = new EventProto.SoteMaze();
      maze.setMaze(e.soteMaze.maze as Proto<EventProto.SoteMaze.MazeMap>);
      maze.setOverworldTilesList(
        e.soteMaze.activeTiles.map((tile) => {
          const coords = new CoordsProto();
          coords.setX(tile.x);
          coords.setY(tile.y);
          return coords;
        }),
      );
      proto.setSoteMaze(maze);
      break;
    }

    case EventType.TOB_XARPUS_PHASE: {
      const e = event as XarpusPhaseEvent;
      proto.setXarpusPhase(e.xarpusPhase as Proto<EventProto.XarpusPhaseMap>);
      break;
    }

    case EventType.TOB_VERZIK_PHASE: {
      const e = event as VerzikPhaseEvent;
      proto.setVerzikPhase(e.verzikPhase as Proto<EventProto.VerzikPhaseMap>);
      break;
    }

    case EventType.CHALLENGE_START:
    case EventType.CHALLENGE_END:
    case EventType.CHALLENGE_UPDATE:
    case EventType.STAGE_UPDATE:
    case EventType.TOB_VERZIK_ATTACK_STYLE:
    case EventType.COLOSSEUM_HANDICAP_CHOICE:
      break;
  }

  return proto;
}

async function main() {
  if (!process.env.BLERT_DATABASE_URI) {
    throw new Error('BLERT_DATABASE_URI environment variable is required');
  }
  if (!process.env.BLERT_MONGODB_URI) {
    throw new Error('BLERT_MONGODB_URI environment variable is required');
  }

  await mongoose.connect(process.env.BLERT_MONGODB_URI);
  const sql = postgres(process.env.BLERT_DATABASE_URI);

  if (process.argv[2] === 'find-broken') {
    const brokenRaids = await findBrokenRaids();
    for (const [raidId, stages] of brokenRaids) {
      console.log(`Broken raid ${raidId} stages ${stages.join(', ')}`);
    }
    console.log(`${brokenRaids.size} broken raids in total`);
    return;
  }

  if (process.argv[2] === 'fix-all-broken') {
    const brokenRaids = await findBrokenRaids();
    for (const [raidId, stages] of brokenRaids) {
      console.log(`Fixing raid ${raidId} stages ${stages.join(', ')}`);
      for (const stage of stages) {
        await fixChallenge(raidId, stage, 0);
      }
    }
    return;
  }

  if (process.argv[2] === 'fix') {
    if (process.argv.length < 5) {
      throw new Error(
        `usage: ${process.argv[1]} fix <challenge_id> <stage> [ticks]`,
      );
    }

    const ticks = process.argv.length === 6 ? parseInt(process.argv[5]) : 0;
    await fixChallenge(process.argv[3], parseInt(process.argv[4]), ticks);
    return;
  }

  if (process.argv.length !== 2) {
    throw new Error('usage: migrate-mongo-to-postgres [find-broken|fix]');
  }

  if (!process.env.BLERT_OUT_DIR) {
    throw new Error('BLERT_OUT_DIR environment variable is required');
  }

  const users = await migrateUsers(sql);
  const players = await migratePlayers(sql);

  await migrateApiKeys(sql, users, players);
  await migrateNameChanges(sql, users, players);

  const challenges = await migrateChallenges(sql, players);
  await migrateRecordedChallenges(sql, users, challenges);

  await migratePersonalBests(sql, players);

  await Promise.all(
    Array.from(players.values()).map(
      (player) => sql`
          UPDATE players
          SET total_recordings = ${player.totalRecordings}
          WHERE id = ${player.id};
        `,
    ),
  );

  await migrateRoomEvents(sql, challenges, players);
  await migratePlayerStats(sql, players);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .then(() => process.exit(0));

async function findBrokenRaids(): Promise<Map<string, Stage[]>> {
  const raids = await RaidModel.find(
    { type: ChallengeType.TOB },
    {},
    { sort: { startTime: 1 } },
  ).exec();

  const brokenRaids: Map<string, Stage[]> = new Map();

  for (const raid of raids) {
    const rooms: Array<[keyof OldTobRooms, Stage]> = [
      ['maiden', Stage.TOB_MAIDEN],
      ['bloat', Stage.TOB_BLOAT],
      ['nylocas', Stage.TOB_NYLOCAS],
      ['sotetseg', Stage.TOB_SOTETSEG],
      ['xarpus', Stage.TOB_XARPUS],
      ['verzik', Stage.TOB_VERZIK],
    ];

    const broken: Stage[] = [];

    for (const [room, stage] of rooms) {
      if (raid.tobRooms[room] === null) {
        continue;
      }

      const npcs = raid.tobRooms[room]!.npcs as unknown as Map<string, RoomNpc>;
      const isBroken = Array.from(npcs.values()).some(
        (npc) => typeof npc.type === 'string',
      );
      if (isBroken) {
        broken.push(stage);
      }
    }

    if (broken.length > 0) {
      brokenRaids.set(raid._id, broken);
    }
  }

  return brokenRaids;
}

async function fixChallenge(challengeId: string, stage: number, ticks: number) {
  console.log(`Fixing challenge ${challengeId} stage ${stage} ticks ${ticks}`);

  const raid = await RaidModel.findById(challengeId).exec();
  if (raid === null) {
    throw new Error(`Challenge ${challengeId} not found`);
  }

  if (ticks > 0) {
    await RoomEvent.updateMany(
      { cId: challengeId, stage },
      { $inc: { tick: ticks }, $set: { acc: false } },
    );
    await RoomEvent.updateMany(
      { cId: challengeId, stage, type: EventType.PLAYER_UPDATE },
      { $inc: { 'player.offCooldownTick': ticks } },
    );

    switch (stage) {
      case Stage.TOB_MAIDEN:
        raid.tobRooms.maiden!.firstTick = ticks;
        if (raid.tobRooms.maiden!.splits.SEVENTIES !== 0) {
          raid.tobRooms.maiden!.splits.SEVENTIES += ticks;
        }
        if (raid.tobRooms.maiden!.splits.FIFTIES !== 0) {
          raid.tobRooms.maiden!.splits.FIFTIES += ticks;
        }
        if (raid.tobRooms.maiden!.splits.THIRTIES !== 0) {
          raid.tobRooms.maiden!.splits.THIRTIES += ticks;
        }
        break;
      case Stage.TOB_BLOAT:
        raid.tobRooms.bloat!.firstTick = ticks;
        raid.tobRooms.bloat!.splits.downTicks =
          raid.tobRooms.bloat!.splits.downTicks.map((t) => t + ticks);
        break;
      case Stage.TOB_NYLOCAS:
        raid.tobRooms.nylocas!.firstTick = ticks;
        if (raid.tobRooms.nylocas!.splits.capIncrease !== 0) {
          raid.tobRooms.nylocas!.splits.capIncrease += ticks;
        }
        if (raid.tobRooms.nylocas!.splits.waves !== 0) {
          raid.tobRooms.nylocas!.splits.waves += ticks;
        }
        if (raid.tobRooms.nylocas!.splits.cleanup !== 0) {
          raid.tobRooms.nylocas!.splits.cleanup += ticks;
        }
        if (raid.tobRooms.nylocas!.splits.boss !== 0) {
          raid.tobRooms.nylocas!.splits.boss += ticks;
        }
        break;
      case Stage.TOB_SOTETSEG:
        raid.tobRooms.sotetseg!.firstTick = ticks;
        if (raid.tobRooms.sotetseg!.splits.MAZE_66 !== 0) {
          raid.tobRooms.sotetseg!.splits.MAZE_66 += ticks;
        }
        if (raid.tobRooms.sotetseg!.splits.MAZE_33 !== 0) {
          raid.tobRooms.sotetseg!.splits.MAZE_33 += ticks;
        }
        break;
      case Stage.TOB_XARPUS:
        raid.tobRooms.xarpus!.firstTick = ticks;
        if (raid.tobRooms.xarpus!.splits.exhumes !== 0) {
          raid.tobRooms.xarpus!.splits.exhumes += ticks;
        }
        if (raid.tobRooms.xarpus!.splits.screech !== 0) {
          raid.tobRooms.xarpus!.splits.screech += ticks;
        }
        break;
      case Stage.TOB_VERZIK:
        raid.tobRooms.verzik!.firstTick = ticks;
        if (raid.tobRooms.verzik!.splits.p1 !== 0) {
          raid.tobRooms.verzik!.splits.p1 += ticks;
        }
        if (raid.tobRooms.verzik!.splits.reds !== 0) {
          raid.tobRooms.verzik!.splits.reds += ticks;
        }
        if (raid.tobRooms.verzik!.splits.p2 !== 0) {
          raid.tobRooms.verzik!.splits.p2 += ticks;
        }
        break;
      default:
        throw new Error(`Invalid stage ${stage}`);
    }
  }

  const fixNpcs = (npcs: Map<string, RoomNpc>) => {
    let modified = false;

    npcs.forEach((npc) => {
      switch (npc.type as unknown) {
        case 'BASIC':
          npc.type = RoomNpcType.BASIC;
          modified = true;
          break;
        case 'MAIDEN_CRAB':
          npc.type = RoomNpcType.MAIDEN_CRAB;
          const maidenCrab = npc as MaidenCrab;
          switch (maidenCrab.maidenCrab.spawn as unknown) {
            case 'SEVENTIES':
              maidenCrab.maidenCrab.spawn = MaidenCrabSpawn.SEVENTIES;
              break;
            case 'FIFTIES':
              maidenCrab.maidenCrab.spawn = MaidenCrabSpawn.FIFTIES;
              break;
            case 'THIRTIES':
              maidenCrab.maidenCrab.spawn = MaidenCrabSpawn.THIRTIES;
              break;
          }
          switch (maidenCrab.maidenCrab.position as unknown) {
            case 'S1':
              maidenCrab.maidenCrab.position = MaidenCrabPosition.S1;
              break;
            case 'S2':
              maidenCrab.maidenCrab.position = MaidenCrabPosition.S2;
              break;
            case 'S3':
              maidenCrab.maidenCrab.position = MaidenCrabPosition.S3;
              break;
            case 'S4_INNER':
              maidenCrab.maidenCrab.position = MaidenCrabPosition.S4_INNER;
              break;
            case 'S4_OUTER':
              maidenCrab.maidenCrab.position = MaidenCrabPosition.S4_OUTER;
              break;
            case 'N1':
              maidenCrab.maidenCrab.position = MaidenCrabPosition.N1;
              break;
            case 'N2':
              maidenCrab.maidenCrab.position = MaidenCrabPosition.N2;
              break;
            case 'N3':
              maidenCrab.maidenCrab.position = MaidenCrabPosition.N3;
              break;
            case 'N4_INNER':
              maidenCrab.maidenCrab.position = MaidenCrabPosition.N4_INNER;
              break;
            case 'N4_OUTER':
              maidenCrab.maidenCrab.position = MaidenCrabPosition.N4_OUTER;
              break;
          }
          modified = true;
          break;
        case 'NYLO':
          npc.type = RoomNpcType.NYLO;
          const nylo = npc as Nylo;
          switch (nylo.nylo.spawnType as unknown) {
            case 'EAST':
              nylo.nylo.spawnType = NyloSpawn.EAST;
              break;
            case 'WEST':
              nylo.nylo.spawnType = NyloSpawn.WEST;
              break;
            case 'SOUTH':
              nylo.nylo.spawnType = NyloSpawn.SOUTH;
              break;
            case 'SPLIT':
              nylo.nylo.spawnType = NyloSpawn.SPLIT;
              break;
          }
          switch (nylo.nylo.style as unknown) {
            case 'RANGE':
              nylo.nylo.style = NyloStyle.RANGE;
              break;
            case 'MAGE':
              nylo.nylo.style = NyloStyle.MAGE;
              break;
            case 'MELEE':
              nylo.nylo.style = NyloStyle.MELEE;
              break;
          }
          modified = true;
          break;
        case 'VERZIK_CRAB':
          npc.type = RoomNpcType.VERZIK_CRAB;
          const verzikCrab = npc as VerzikCrab;
          switch (verzikCrab.verzikCrab.phase as unknown) {
            case 'P1':
              verzikCrab.verzikCrab.phase = VerzikPhase.P1;
              break;
            case 'P2':
              verzikCrab.verzikCrab.phase = VerzikPhase.P2;
              break;
            case 'P3':
              verzikCrab.verzikCrab.phase = VerzikPhase.P3;
              break;
          }
          switch (verzikCrab.verzikCrab.spawn as unknown) {
            case 'UNKNOWN':
              verzikCrab.verzikCrab.spawn = VerzikCrabSpawn.UNKNOWN;
              break;
            case 'NORTH':
              verzikCrab.verzikCrab.spawn = VerzikCrabSpawn.NORTH;
              break;
            case 'NORTHEAST':
              verzikCrab.verzikCrab.spawn = VerzikCrabSpawn.NORTHEAST;
              break;
            case 'NORTHWEST':
              verzikCrab.verzikCrab.spawn = VerzikCrabSpawn.NORTHWEST;
              break;
            case 'EAST':
              verzikCrab.verzikCrab.spawn = VerzikCrabSpawn.EAST;
              break;
            case 'SOUTH':
              verzikCrab.verzikCrab.spawn = VerzikCrabSpawn.SOUTH;
              break;
            case 'SOUTHEAST':
              verzikCrab.verzikCrab.spawn = VerzikCrabSpawn.SOUTHEAST;
              break;
            case 'SOUTHWEST':
              verzikCrab.verzikCrab.spawn = VerzikCrabSpawn.SOUTHWEST;
              break;
            case 'WEST':
              verzikCrab.verzikCrab.spawn = VerzikCrabSpawn.WEST;
              break;
          }
          modified = true;
          break;
      }
    });

    return modified;
  };

  switch (stage) {
    case Stage.TOB_MAIDEN:
      if (
        fixNpcs(raid.tobRooms.maiden!.npcs as unknown as Map<string, RoomNpc>)
      ) {
        raid.markModified('tobRooms.maiden');
      }
      break;
    case Stage.TOB_BLOAT:
      if (
        fixNpcs(raid.tobRooms.bloat!.npcs as unknown as Map<string, RoomNpc>)
      ) {
        raid.markModified('tobRooms.bloat');
      }
      break;
    case Stage.TOB_NYLOCAS:
      if (
        fixNpcs(raid.tobRooms.nylocas!.npcs as unknown as Map<string, RoomNpc>)
      ) {
        raid.markModified('tobRooms.nylocas');
      }
      break;
    case Stage.TOB_SOTETSEG:
      if (
        fixNpcs(raid.tobRooms.sotetseg!.npcs as unknown as Map<string, RoomNpc>)
      ) {
        raid.markModified('tobRooms.sotetseg');
      }
      break;
    case Stage.TOB_XARPUS:
      if (
        fixNpcs(raid.tobRooms.xarpus!.npcs as unknown as Map<string, RoomNpc>)
      ) {
        raid.markModified('tobRooms.xarpus');
      }
      break;
    case Stage.TOB_VERZIK:
      if (
        fixNpcs(raid.tobRooms.verzik!.npcs as unknown as Map<string, RoomNpc>)
      ) {
        raid.markModified('tobRooms.verzik');
      }
      break;
  }

  await raid.save();
}
