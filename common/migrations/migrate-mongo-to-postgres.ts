import mongoose, { HydratedDocument, Types, get } from 'mongoose';
import postgres from 'postgres';

import { ApiKeyModel } from '../models/api-key';
import { PlayerModel } from '../models/player';
import { RaidModel } from '../models/raid';
import { RoomEvent } from '../models/room-event';
import { RecordedChallengeModel, UserModel } from '../models/user';
import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  ColosseumChallenge,
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
  TobRaid,
  TobRooms,
  VerzikCrab,
  VerzikCrabSpawn,
  VerzikPhase,
} from '../raid-definitions';
import {
  LegacyPersonalBestType,
  SplitType,
  tobSplitForMode,
} from '../personal-best';
import {
  BloatDownEvent,
  Event,
  EventType,
  NpcAttackEvent,
  NpcEvent,
  NyloWaveStallEvent,
  PlayerAttackEvent,
} from '../event';
import { NameChangeModel } from '../models/name-change';

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
};

async function migrateUsers(sql: postgres.Sql): Promise<Map<string, number>> {
  const users = await UserModel.find({}, {}, { sort: { _id: 1 } }).exec();
  const userMap = new Map<string, number>();

  for (const user of users) {
    const users = await sql`
        INSERT INTO users (username, password, email, email_verified, can_create_api_key)
        VALUES (${user.username}, ${user.password}, ${user.email}, ${user.emailVerified || false}, ${user.canCreateApiKey || false})
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

function legacyPersonalBestToSplitType(pb: LegacyPersonalBestType): SplitType {
  switch (pb) {
    case LegacyPersonalBestType.TOB_ENTRY_CHALLENGE:
      return SplitType.TOB_ENTRY_CHALLENGE;
    case LegacyPersonalBestType.TOB_REG_CHALLENGE:
      return SplitType.TOB_REG_CHALLENGE;
    case LegacyPersonalBestType.TOB_HM_CHALLENGE:
      return SplitType.TOB_HM_CHALLENGE;
    case LegacyPersonalBestType.TOB_ENTRY_OVERALL:
      return SplitType.TOB_ENTRY_OVERALL;
    case LegacyPersonalBestType.TOB_REG_OVERALL:
      return SplitType.TOB_REG_OVERALL;
    case LegacyPersonalBestType.TOB_HM_OVERALL:
      return SplitType.TOB_HM_OVERALL;
    case LegacyPersonalBestType.TOB_ENTRY_MAIDEN:
      return SplitType.TOB_ENTRY_MAIDEN;
    case LegacyPersonalBestType.TOB_REG_MAIDEN:
      return SplitType.TOB_REG_MAIDEN;
    case LegacyPersonalBestType.TOB_HM_MAIDEN:
      return SplitType.TOB_HM_MAIDEN;
    case LegacyPersonalBestType.TOB_ENTRY_BLOAT:
      return SplitType.TOB_ENTRY_BLOAT;
    case LegacyPersonalBestType.TOB_REG_BLOAT:
      return SplitType.TOB_REG_BLOAT;
    case LegacyPersonalBestType.TOB_HM_BLOAT:
      return SplitType.TOB_HM_BLOAT;
    case LegacyPersonalBestType.TOB_ENTRY_NYLO_ROOM:
      return SplitType.TOB_ENTRY_NYLO_ROOM;
    case LegacyPersonalBestType.TOB_REG_NYLO_ROOM:
      return SplitType.TOB_REG_NYLO_ROOM;
    case LegacyPersonalBestType.TOB_HM_NYLO_ROOM:
      return SplitType.TOB_HM_NYLO_ROOM;
    case LegacyPersonalBestType.TOB_ENTRY_NYLO_BOSS_SPAWN:
      return SplitType.TOB_ENTRY_NYLO_BOSS_SPAWN;
    case LegacyPersonalBestType.TOB_REG_NYLO_BOSS_SPAWN:
      return SplitType.TOB_REG_NYLO_BOSS_SPAWN;
    case LegacyPersonalBestType.TOB_HM_NYLO_BOSS_SPAWN:
      return SplitType.TOB_HM_NYLO_BOSS_SPAWN;
    case LegacyPersonalBestType.TOB_ENTRY_NYLO_BOSS:
      return SplitType.TOB_ENTRY_NYLO_BOSS;
    case LegacyPersonalBestType.TOB_REG_NYLO_BOSS:
      return SplitType.TOB_REG_NYLO_BOSS;
    case LegacyPersonalBestType.TOB_HM_NYLO_BOSS:
      return SplitType.TOB_HM_NYLO_BOSS;
    case LegacyPersonalBestType.TOB_ENTRY_SOTETSEG:
      return SplitType.TOB_ENTRY_SOTETSEG;
    case LegacyPersonalBestType.TOB_REG_SOTETSEG:
      return SplitType.TOB_REG_SOTETSEG;
    case LegacyPersonalBestType.TOB_HM_SOTETSEG:
      return SplitType.TOB_HM_SOTETSEG;
    case LegacyPersonalBestType.TOB_ENTRY_XARPUS:
      return SplitType.TOB_ENTRY_XARPUS;
    case LegacyPersonalBestType.TOB_REG_XARPUS:
      return SplitType.TOB_REG_XARPUS;
    case LegacyPersonalBestType.TOB_HM_XARPUS:
      return SplitType.TOB_HM_XARPUS;
    case LegacyPersonalBestType.TOB_ENTRY_VERZIK_ROOM:
      return SplitType.TOB_ENTRY_VERZIK_ROOM;
    case LegacyPersonalBestType.TOB_REG_VERZIK_ROOM:
      return SplitType.TOB_REG_VERZIK_ROOM;
    case LegacyPersonalBestType.TOB_HM_VERZIK_ROOM:
      return SplitType.TOB_HM_VERZIK_ROOM;
    case LegacyPersonalBestType.TOB_ENTRY_VERZIK_P1:
      return SplitType.TOB_ENTRY_VERZIK_P1;
    case LegacyPersonalBestType.TOB_REG_VERZIK_P1:
      return SplitType.TOB_REG_VERZIK_P1;
    case LegacyPersonalBestType.TOB_HM_VERZIK_P1:
      return SplitType.TOB_HM_VERZIK_P1;
    case LegacyPersonalBestType.TOB_ENTRY_VERZIK_P2:
      return SplitType.TOB_ENTRY_VERZIK_P2;
    case LegacyPersonalBestType.TOB_REG_VERZIK_P2:
      return SplitType.TOB_REG_VERZIK_P2;
    case LegacyPersonalBestType.TOB_HM_VERZIK_P2:
      return SplitType.TOB_HM_VERZIK_P2;
    case LegacyPersonalBestType.TOB_ENTRY_VERZIK_P3:
      return SplitType.TOB_ENTRY_VERZIK_P3;
    case LegacyPersonalBestType.TOB_REG_VERZIK_P3:
      return SplitType.TOB_REG_VERZIK_P3;
    case LegacyPersonalBestType.TOB_HM_VERZIK_P3:
      return SplitType.TOB_HM_VERZIK_P3;
    case LegacyPersonalBestType.COLOSSEUM_CHALLENGE:
      return SplitType.COLOSSEUM_CHALLENGE;
    case LegacyPersonalBestType.COLOSSEUM_OVERALL:
      return SplitType.COLOSSEUM_OVERALL;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_1:
      return SplitType.COLOSSEUM_WAVE_1;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_2:
      return SplitType.COLOSSEUM_WAVE_2;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_3:
      return SplitType.COLOSSEUM_WAVE_3;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_4:
      return SplitType.COLOSSEUM_WAVE_4;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_5:
      return SplitType.COLOSSEUM_WAVE_5;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_6:
      return SplitType.COLOSSEUM_WAVE_6;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_7:
      return SplitType.COLOSSEUM_WAVE_7;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_8:
      return SplitType.COLOSSEUM_WAVE_8;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_9:
      return SplitType.COLOSSEUM_WAVE_9;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_10:
      return SplitType.COLOSSEUM_WAVE_10;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_11:
      return SplitType.COLOSSEUM_WAVE_11;
    case LegacyPersonalBestType.COLOSSEUM_WAVE_12:
      return SplitType.COLOSSEUM_WAVE_12;
  }

  throw new Error(`Invalid personal best type ${pb}`);
}

function getMaidenSplits(raid: TobRaid, raidId: number): Split[] {
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
      type: tobSplitForMode(SplitType.TOB_MAIDEN, raid.mode),
      scale,
      ticks: maidenData.roomTicks,
      accurate: accurateMaidenData,
    });

    if (maidenData.splits.SEVENTIES > 0) {
      maidenSplits.push({
        name: 'Maiden 70s',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_MAIDEN_70S, raid.mode),
        scale,
        ticks: maidenData.splits.SEVENTIES,
        accurate: accurateMaidenData,
      });

      if (maidenData.splits.FIFTIES > 0) {
        maidenSplits.push({
          name: 'Maiden 50s',
          challenge_id: raidId,
          type: tobSplitForMode(SplitType.TOB_MAIDEN_50S, raid.mode),
          scale,
          ticks: maidenData.splits.FIFTIES,
          accurate: accurateMaidenData,
        });

        maidenSplits.push({
          name: 'Maiden 70s-50s',
          challenge_id: raidId,
          type: tobSplitForMode(SplitType.TOB_MAIDEN_70S_50S, raid.mode),
          scale,
          ticks: maidenData.splits.FIFTIES - maidenData.splits.SEVENTIES,
          accurate: accurateMaidenData,
        });

        if (maidenData.splits.THIRTIES > 0) {
          maidenSplits.push({
            name: 'Maiden 30s',
            challenge_id: raidId,
            type: tobSplitForMode(SplitType.TOB_MAIDEN_30S, raid.mode),
            scale,
            ticks: maidenData.splits.THIRTIES,
            accurate: accurateMaidenData,
          });

          maidenSplits.push({
            name: 'Maiden 50s-30s',
            challenge_id: raidId,
            type: tobSplitForMode(SplitType.TOB_MAIDEN_50S_30S, raid.mode),
            scale,
            ticks: maidenData.splits.THIRTIES - maidenData.splits.FIFTIES,
            accurate: accurateMaidenData,
          });

          maidenSplits.push({
            name: 'Maiden 30s-end',
            challenge_id: raidId,
            type: tobSplitForMode(SplitType.TOB_MAIDEN_30S_END, raid.mode),
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

function getBloatSplits(raid: TobRaid, raidId: number): Split[] {
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
      type: tobSplitForMode(SplitType.TOB_BLOAT, raid.mode),
      scale,
      ticks: bloatData.roomTicks,
      accurate: accurateBloatData,
    });
  }

  return bloatSplits;
}

function getNylocasSplits(raid: TobRaid, raidId: number): Split[] {
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
      type: tobSplitForMode(SplitType.TOB_NYLO_ROOM, raid.mode),
      scale,
      ticks: nylocasData.roomTicks,
      accurate: accurateNylocasData,
    });

    if (nylocasData.splits.capIncrease > 0) {
      nylocasSplits.push({
        name: 'Nylocas cap increase',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_NYLO_CAP, raid.mode),
        scale,
        ticks: nylocasData.splits.capIncrease,
        accurate: accurateNylocasData,
      });
    }

    if (nylocasData.splits.waves > 0) {
      nylocasSplits.push({
        name: 'Nylocas waves',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_NYLO_WAVES, raid.mode),
        scale,
        ticks: nylocasData.splits.waves,
        accurate: accurateNylocasData,
      });
    }

    if (nylocasData.splits.cleanup > 0) {
      nylocasSplits.push({
        name: 'Nylocas cleanup',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_NYLO_CLEANUP, raid.mode),
        scale,
        ticks: nylocasData.splits.cleanup,
        accurate: accurateNylocasData,
      });
    }

    if (nylocasData.splits.boss > 0) {
      nylocasSplits.push({
        name: 'Nylocas waves',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_NYLO_BOSS_SPAWN, raid.mode),
        scale,
        ticks: nylocasData.splits.boss,
        accurate: accurateNylocasData,
      });

      nylocasSplits.push({
        name: 'Nylocas boss',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_NYLO_BOSS, raid.mode),
        scale,
        ticks: nylocasData.roomTicks - nylocasData.splits.boss,
        accurate: accurateNylocasData,
      });
    }
  }

  return nylocasSplits;
}

function getSotetsegSplits(raid: TobRaid, raidId: number): Split[] {
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
      type: tobSplitForMode(SplitType.TOB_SOTETSEG, raid.mode),
      scale,
      ticks: sotetsegData.roomTicks,
      accurate: accurateSotetsegData,
    });

    if (sotetsegData.splits.MAZE_66 > 0) {
      sotetsegSplits.push({
        name: 'Sotetseg maze 66',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_SOTETSEG_66, raid.mode),
        scale,
        ticks: sotetsegData.splits.MAZE_66,
        accurate: accurateSotetsegData,
      });

      if (sotetsegData.maze66 && sotetsegData.maze66.ticks > 0) {
        sotetsegSplits.push({
          name: 'Sotetseg maze 1',
          challenge_id: raidId,
          type: tobSplitForMode(SplitType.TOB_SOTETSEG_MAZE_1, raid.mode),
          scale,
          ticks: sotetsegData.maze66.ticks,
          accurate: accurateSotetsegData,
        });
      }

      if (sotetsegData.splits.MAZE_33 > 0) {
        sotetsegSplits.push({
          name: 'Sotetseg maze 33',
          challenge_id: raidId,
          type: tobSplitForMode(SplitType.TOB_SOTETSEG_33, raid.mode),
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
            type: tobSplitForMode(SplitType.TOB_SOTETSEG_P2, raid.mode),
            scale,
            ticks: sotetsegData.splits.MAZE_33 - maze1End,
            accurate: accurateSotetsegData,
          });
        }

        if (sotetsegData.maze33 && sotetsegData.maze33.ticks > 0) {
          sotetsegSplits.push({
            name: 'Sotetseg maze 2',
            challenge_id: raidId,
            type: tobSplitForMode(SplitType.TOB_SOTETSEG_MAZE_2, raid.mode),
            scale,
            ticks: sotetsegData.maze33.ticks,
            accurate: accurateSotetsegData,
          });

          const maze2End =
            sotetsegData.splits.MAZE_33 + sotetsegData.maze33.ticks;
          sotetsegSplits.push({
            name: 'Sotetseg P3',
            challenge_id: raidId,
            type: tobSplitForMode(SplitType.TOB_SOTETSEG_P3, raid.mode),
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

function getXarpusSplits(raid: TobRaid, raidId: number): Split[] {
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
      type: tobSplitForMode(SplitType.TOB_XARPUS, raid.mode),
      scale,
      ticks: xarpusData.roomTicks,
      accurate: accurateXarpusData,
    });

    if (xarpusData.splits.exhumes > 0) {
      xarpusSplits.push({
        name: 'Xarpus exhumes',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_XARPUS_EXHUMES, raid.mode),
        scale,
        ticks: xarpusData.splits.exhumes,
        accurate: accurateXarpusData,
      });
    }

    if (xarpusData.splits.screech > 0) {
      xarpusSplits.push({
        name: 'Xarpus screech',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_XARPUS_SCREECH, raid.mode),
        scale,
        ticks: xarpusData.splits.screech,
        accurate: accurateXarpusData,
      });

      xarpusSplits.push({
        name: 'Xarpus P2',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_XARPUS_P2, raid.mode),
        scale,
        ticks: xarpusData.splits.screech - xarpusData.splits.exhumes,
        accurate: accurateXarpusData,
      });

      xarpusSplits.push({
        name: 'Xarpus P3',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_XARPUS_P3, raid.mode),
        scale,
        ticks: xarpusData.roomTicks - xarpusData.splits.screech,
        accurate: accurateXarpusData,
      });
    }
  }

  return xarpusSplits;
}

function getVerzikSplits(raid: TobRaid, raidId: number): Split[] {
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
      type: tobSplitForMode(SplitType.TOB_VERZIK_ROOM, raid.mode),
      scale,
      ticks: verzikData.roomTicks,
      accurate: accurateVerzikData,
    });

    if (verzikData.splits.p1 > 0) {
      verzikSplits.push({
        name: 'Verzik P1',
        challenge_id: raidId,
        type: tobSplitForMode(SplitType.TOB_VERZIK_P1_END, raid.mode),
        scale,
        ticks: verzikData.splits.p1,
        accurate: accurateVerzikData,
      });

      if (verzikData.splits.reds > 0) {
        verzikSplits.push({
          name: 'Verzik reds',
          challenge_id: raidId,
          type: tobSplitForMode(SplitType.TOB_VERZIK_REDS, raid.mode),
          scale,
          ticks: verzikData.splits.reds,
          accurate: accurateVerzikData,
        });

        if (verzikData.splits.p2 > 0) {
          verzikSplits.push({
            name: 'Verzik P2 end',
            challenge_id: raidId,
            type: tobSplitForMode(SplitType.TOB_VERZIK_P2_END, raid.mode),
            scale,
            ticks: verzikData.splits.p2,
            accurate: accurateVerzikData,
          });

          verzikSplits.push({
            name: 'Verzik P2',
            challenge_id: raidId,
            type: tobSplitForMode(SplitType.TOB_VERZIK_P2, raid.mode),
            scale,
            ticks: verzikData.splits.p2 - (verzikData.splits.p1 + 13),
            accurate: accurateVerzikData,
          });

          verzikSplits.push({
            name: 'Verzik P3',
            challenge_id: raidId,
            type: tobSplitForMode(SplitType.TOB_VERZIK_P3, raid.mode),
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
    const raid = challenge as TobRaid;

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
        type: tobSplitForMode(SplitType.TOB_CHALLENGE, raid.mode),
        scale: raid.party.length,
        ticks: raid.totalTicks,
        accurate: true,
      });
    }
  } else if (challenge.type === ChallengeType.COLOSSEUM) {
    const colo = challenge as ColosseumChallenge;
    splits.push(
      ...colo.colosseum.waves.map((wave, i) => ({
        name: `Wave ${i + 1}`,
        challenge_id: id,
        type: SplitType.COLOSSEUM_WAVE_1 + i,
        scale: 1,
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

type ChallengeNpc = {
  challenge_id: number;
  stage: Stage;
  room_id: number;
  spawn_npc_id: number;
  type: RoomNpcType;
  spawn_tick: number;
  death_tick: number;
  spawn_x: number;
  spawn_y: number;
  death_x: number;
  death_y: number;
  custom_data: any;
};

function translateNpcs(
  stage: Stage,
  npcs: Map<number, RoomNpc>,
): ChallengeNpc[] {
  return Array.from(npcs.values()).map((npc) => ({
    challenge_id: -1,
    stage,
    room_id: npc.roomId,
    spawn_npc_id: npc.spawnNpcId,
    type: npc.type,
    spawn_tick: npc.spawnTick,
    death_tick: npc.deathTick,
    spawn_x: npc.spawnPoint.x,
    spawn_y: npc.spawnPoint.y,
    death_x: npc.deathPoint.x,
    death_y: npc.deathPoint.y,
    custom_data:
      npc.type === RoomNpcType.MAIDEN_CRAB
        ? (npc as MaidenCrab).maidenCrab
        : npc.type === RoomNpcType.NYLO
          ? (npc as Nylo).nylo
          : npc.type === RoomNpcType.VERZIK_CRAB
            ? (npc as VerzikCrab).verzikCrab
            : null,
  }));
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

    let customData: any = null;
    const npcs: ChallengeNpc[] = [];

    if (challenge.type === ChallengeType.TOB) {
      const tob = challenge as TobRaid;
      customData = {};
      if (tob.tobRooms.maiden) {
        customData.maiden = {
          firstTick: tob.tobRooms.maiden.firstTick,
          deaths: tob.tobRooms.maiden.deaths,
        };
        npcs.push(
          ...translateNpcs(Stage.TOB_MAIDEN, tob.tobRooms.maiden.npcs as any),
        );
      }
      if (tob.tobRooms.bloat) {
        customData.bloat = {
          firstTick: tob.tobRooms.bloat.firstTick,
          deaths: tob.tobRooms.bloat.deaths,
          splits: tob.tobRooms.bloat.splits,
        };
        npcs.push(
          ...translateNpcs(Stage.TOB_BLOAT, tob.tobRooms.bloat.npcs as any),
        );
      }
      if (tob.tobRooms.nylocas) {
        customData.nylocas = {
          firstTick: tob.tobRooms.nylocas.firstTick,
          deaths: tob.tobRooms.nylocas.deaths,
          stalls: tob.tobRooms.nylocas.stalledWaves,
        };
        npcs.push(
          ...translateNpcs(Stage.TOB_NYLOCAS, tob.tobRooms.nylocas.npcs as any),
        );
      }
      if (tob.tobRooms.sotetseg) {
        customData.sotetseg = {
          firstTick: tob.tobRooms.sotetseg.firstTick,
          deaths: tob.tobRooms.sotetseg.deaths,
          maze66: tob.tobRooms.sotetseg.maze66?.pivots ?? null,
          maze33: tob.tobRooms.sotetseg.maze33?.pivots ?? null,
        };
        npcs.push(
          ...translateNpcs(
            Stage.TOB_SOTETSEG,
            tob.tobRooms.sotetseg.npcs as any,
          ),
        );
      }
      if (tob.tobRooms.xarpus) {
        customData.xarpus = {
          firstTick: tob.tobRooms.xarpus.firstTick,
          deaths: tob.tobRooms.xarpus.deaths,
        };
        npcs.push(
          ...translateNpcs(Stage.TOB_XARPUS, tob.tobRooms.xarpus.npcs as any),
        );
      }
      if (tob.tobRooms.verzik) {
        customData.verzik = {
          firstTick: tob.tobRooms.verzik.firstTick,
          deaths: tob.tobRooms.verzik.deaths,
          reds: tob.tobRooms.verzik.redCrabSpawns,
        };
        npcs.push(
          ...translateNpcs(Stage.TOB_VERZIK, tob.tobRooms.verzik.npcs as any),
        );
      }
    } else {
      const colo = challenge as ColosseumChallenge;
      customData = {
        handicaps: colo.colosseum.handicaps,
        waves: colo.colosseum.waves.map((wave) => ({
          handicap: wave.handicap,
          options: wave.options,
        })),
      };

      colo.colosseum.waves.forEach((wave, i) => {
        npcs.push(
          ...translateNpcs(Stage.COLOSSEUM_WAVE_1 + i, wave.npcs as any),
        );
      });
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
      primary_gear: challenge.partyInfo[i]?.gear ?? PrimaryMeleeGear.BLORVA,
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
    const raid = challenge as TobRaid;
    switch (stage) {
      case Stage.TOB_MAIDEN:
        return raid.tobRooms.maiden!.npcs as unknown as Map<string, RoomNpc>;
      case Stage.TOB_BLOAT:
        return raid.tobRooms.bloat!.npcs as unknown as Map<string, RoomNpc>;
      case Stage.TOB_NYLOCAS:
        return raid.tobRooms.nylocas!.npcs as unknown as Map<string, RoomNpc>;
      case Stage.TOB_SOTETSEG:
        return raid.tobRooms.sotetseg!.npcs as unknown as Map<string, RoomNpc>;
      case Stage.TOB_XARPUS:
        return raid.tobRooms.xarpus!.npcs as unknown as Map<string, RoomNpc>;
      case Stage.TOB_VERZIK:
        return raid.tobRooms.verzik!.npcs as unknown as Map<string, RoomNpc>;
    }
  } else {
    const colo = challenge as ColosseumChallenge;
    return colo.colosseum.waves[stage - Stage.COLOSSEUM_WAVE_1]
      .npcs as unknown as Map<string, RoomNpc>;
  }

  return new Map();
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
      if (npcId < Math.pow(2, 15)) {
        return npcId;
      }

      const npcs = npcsForStage(challenge, stage);
      return npcs.get(roomId.toString())?.spawnNpcId ?? null;
    };

    const roomEvents = await RoomEvent.find({
      cId: challenge._id,
      acc: true,
    }).exec();

    const events: QueryableEvent[] = [];

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
            evt.custom_int_1 = e.attack.weapon.id;
          }
          evt.custom_short_1 = e.attack.distanceToTarget;
          break;
        }
        case EventType.PLAYER_DEATH: {
          evt = getBasicEventFields(challenge, challengeId, event);
          evt.player_id = getPlayerId(event.player.name);
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
            evt.custom_int_1 = maidenCrab.spawn;
            evt.custom_int_2 = maidenCrab.position;
          }
          evt.custom_short_1 = hitpoints.getCurrent();
          evt.custom_short_2 = hitpoints.getBase();
          break;
        }
        case EventType.TOB_BLOAT_DOWN: {
          const e = event as BloatDownEvent;
          evt = getBasicEventFields(challenge, challengeId, event);
          if (e.bloatDown.downNumber) {
            evt.custom_short_1 = e.bloatDown.downNumber;
          } else {
            evt.custom_short_1 = assumeBloatDownNumber(e.tick);
          }
          evt.custom_short_2 = e.bloatDown.walkTime;
          break;
        }
        case EventType.TOB_NYLO_WAVE_STALL: {
          const e = event as NyloWaveStallEvent;
          evt = getBasicEventFields(challenge, challengeId, event);
          evt.custom_short_1 = e.nyloWave.wave;
          evt.custom_short_2 = e.nyloWave.nylosAlive;
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

      if (evt !== null) {
        events.push(evt);
      }
    }

    const broken = events.find((evt) => {
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

    if (events.length > 0) {
      await sql`
        INSERT INTO queryable_events ${sql(
          events,
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

    totalEventsMigrated += events.length;
    console.log(
      `Migrated ${events.length} events for challenge ${challenge._id} [${i}/${challenges.size}]`,
    );
  }

  console.log(
    `Migrated ${totalEventsMigrated}, skipped ${eventsSkipped} total events`,
  );
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
    const rooms: Array<[keyof TobRooms, Stage]> = [
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

    console.log(npcs);
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
