import {
  BloatDownEvent,
  ColosseumData,
  Event,
  EventType,
  MaidenBloodSplatsEvent,
  MaidenCrab,
  NpcAttackEvent,
  NpcEvent,
  Nylo,
  NyloWaveSpawnEvent,
  NyloWaveStallEvent,
  PlayerAttackEvent,
  PlayerDeathEvent,
  PlayerUpdateEvent,
  RoomNpc,
  RoomNpcMap,
  RoomNpcType,
  SoteMazeEvent,
  SoteMazePathEvent,
  Stage,
  TobRooms,
  VerzikCrab,
  VerzikPhaseEvent,
  XarpusPhaseEvent,
} from '@blert/common';
import {
  ChallengeData,
  ChallengeEvents,
} from '@blert/common/generated/challenge_storage_pb';
import { Event as ProtoEvent } from '@blert/common/generated/event_pb';
import { readFile } from 'fs/promises';
import jspb from 'google-protobuf';

let dataRoot: string;
let fileLoader: <T extends jspb.Message>(
  deserialize: (data: Uint8Array) => T,
  uuid: string,
  file: string,
) => Promise<T>;
if (!process.env.BLERT_STATIC_DATA) {
  console.error('BLERT_STATIC_DATA environment variable is required');
  process.exit(1);
}
if (process.env.BLERT_STATIC_DATA?.startsWith('file://')) {
  dataRoot = process.env.BLERT_STATIC_DATA.slice(7);
  fileLoader = loadFromLocalDirectory;
} else {
  // TODO
  throw new Error('unimplemented');
}

async function loadFromLocalDirectory<T extends jspb.Message>(
  deserialize: (data: Uint8Array) => T,
  uuid: string,
  file: string,
): Promise<T> {
  const subdir = uuid.slice(0, 2);
  const path = `${dataRoot}/${subdir}/${uuid.replaceAll('-', '')}/${file}`;
  const data = await readFile(path);
  return deserialize(data);
}

export async function loadChallengeData(uuid: string): Promise<ChallengeData> {
  return await fileLoader(ChallengeData.deserializeBinary, uuid, 'challenge');
}

export async function loadStageEventsData(
  uuid: string,
  stage: Stage,
): Promise<Event[]> {
  let file;

  switch (stage) {
    case Stage.TOB_MAIDEN:
      file = 'maiden';
      break;
    case Stage.TOB_BLOAT:
      file = 'bloat';
      break;
    case Stage.TOB_NYLOCAS:
      file = 'nylocas';
      break;
    case Stage.TOB_SOTETSEG:
      file = 'sotetseg';
      break;
    case Stage.TOB_XARPUS:
      file = 'xarpus';
      break;
    case Stage.TOB_VERZIK:
      file = 'verzik';
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
      file = `wave-${stage - Stage.COLOSSEUM_WAVE_1 + 1}`;
      break;
    default:
      throw new Error(`Invalid stage: ${stage}`);
  }

  const protoEvents = await fileLoader(
    ChallengeEvents.deserializeBinary,
    uuid,
    file,
  );

  return protoEvents.getEventsList().map((e) => translateEvent(e, protoEvents));
}

export function buildTobRooms(data: ChallengeData): TobRooms {
  const tobRooms: TobRooms = {
    maiden: null,
    bloat: null,
    nylocas: null,
    sotetseg: null,
    xarpus: null,
    verzik: null,
  };

  if (data.hasTobRooms()) {
    const tobData = data.getTobRooms()!;

    if (tobData.hasMaiden()) {
      const maiden = tobData.getMaiden()!;
      tobRooms.maiden = {
        stage: Stage.TOB_MAIDEN,
        ticksLost: maiden.getTicksLost(),
        deaths: maiden.getDeathsList(),
        npcs: buildNpcsMap(maiden.getNpcsList()),
      };
    }

    if (tobData.hasBloat()) {
      const bloat = tobData.getBloat()!;
      tobRooms.bloat = {
        stage: Stage.TOB_BLOAT,
        ticksLost: bloat.getTicksLost(),
        deaths: bloat.getDeathsList(),
        downTicks: bloat.getBloatDownTicksList(),
        npcs: buildNpcsMap(bloat.getNpcsList()),
      };
    }

    if (tobData.hasNylocas()) {
      const nylocas = tobData.getNylocas()!;
      tobRooms.nylocas = {
        stage: Stage.TOB_NYLOCAS,
        ticksLost: nylocas.getTicksLost(),
        deaths: nylocas.getDeathsList(),
        stalledWaves: nylocas.getNyloWavesStalledList(),
        npcs: buildNpcsMap(nylocas.getNpcsList()),
      };
    }

    if (tobData.hasSotetseg()) {
      const sotetseg = tobData.getSotetseg()!;
      tobRooms.sotetseg = {
        stage: Stage.TOB_SOTETSEG,
        ticksLost: sotetseg.getTicksLost(),
        deaths: sotetseg.getDeathsList(),
        maze1Pivots: sotetseg.getSotetsegMaze1PivotsList(),
        maze2Pivots: sotetseg.getSotetsegMaze2PivotsList(),
        npcs: buildNpcsMap(sotetseg.getNpcsList()),
      };
    }

    if (tobData.hasXarpus()) {
      const xarpus = tobData.getXarpus()!;
      tobRooms.xarpus = {
        stage: Stage.TOB_XARPUS,
        ticksLost: xarpus.getTicksLost(),
        deaths: xarpus.getDeathsList(),
        npcs: buildNpcsMap(xarpus.getNpcsList()),
      };
    }

    if (tobData.hasVerzik()) {
      const verzik = tobData.getVerzik()!;
      tobRooms.verzik = {
        stage: Stage.TOB_VERZIK,
        ticksLost: verzik.getTicksLost(),
        deaths: verzik.getDeathsList(),
        redsSpawnCount: verzik.getVerzikRedsCount(),
        npcs: buildNpcsMap(verzik.getNpcsList()),
      };
    }
  }

  return tobRooms;
}

export function buildColosseumData(data: ChallengeData): ColosseumData {
  return {
    handicaps: [],
    waves: [],
  };
}

/**
 * Translates protobuf NPC data into a map of room IDs to room NPCs.
 * @param npcs The list of NPCs to translate.
 * @returns Translated NPCs map.
 */
function buildNpcsMap(npcs: ChallengeData.StageNpc[]): RoomNpcMap {
  let map: RoomNpcMap = {};

  npcs.forEach((npc) => {
    let roomNpc: RoomNpc = {
      type: RoomNpcType.BASIC,
      roomId: npc.getRoomId(),
      spawnNpcId: npc.getSpawnNpcId(),
      spawnTick: npc.getSpawnTick(),
      spawnPoint: {
        x: npc.getSpawnPoint()?.getX() ?? 0,
        y: npc.getSpawnPoint()?.getY() ?? 0,
      },
      deathTick: npc.getDeathTick(),
      deathPoint: {
        x: npc.getDeathPoint()?.getX() ?? 0,
        y: npc.getDeathPoint()?.getY() ?? 0,
      },
    };

    if (npc.hasMaidenCrab()) {
      roomNpc.type = RoomNpcType.MAIDEN_CRAB;
      (roomNpc as MaidenCrab).maidenCrab = npc.getMaidenCrab()!.toObject();
    }
    if (npc.hasNylo()) {
      roomNpc.type = RoomNpcType.NYLO;
      (roomNpc as Nylo).nylo = npc.getNylo()!.toObject();
    }
    if (npc.hasVerzikCrab()) {
      roomNpc.type = RoomNpcType.VERZIK_CRAB;
      (roomNpc as VerzikCrab).verzikCrab = npc.getVerzikCrab()!.toObject();
    }

    map[roomNpc.roomId] = roomNpc;
  });

  return map;
}

function translateEvent(evt: ProtoEvent, eventData: ChallengeEvents): Event {
  const event: Partial<Event> = {
    type: evt.getType(),
    stage: evt.getStage(),
    tick: evt.getTick(),
    xCoord: evt.getXCoord(),
    yCoord: evt.getYCoord(),
  };

  const party = eventData.getPartyNamesList();

  switch (evt.getType()) {
    case EventType.PLAYER_UPDATE: {
      const player = evt.getPlayer()!;
      const e = event as PlayerUpdateEvent;
      e.player = {
        source: player.getDataSource(),
        offCooldownTick: player.getOffCooldownTick(),
        prayerSet: player.getActivePrayers(),
        name: party[player.getPartyIndex()],
      };
      if (player.hasHitpoints()) {
        e.player.hitpoints = player.getHitpoints();
      }
      if (player.hasPrayer()) {
        e.player.prayer = player.getPrayer();
      }
      if (player.hasAttack()) {
        e.player.attack = player.getAttack();
      }
      if (player.hasStrength()) {
        e.player.strength = player.getStrength();
      }
      if (player.hasDefence()) {
        e.player.defence = player.getDefence();
      }
      if (player.hasRanged()) {
        e.player.ranged = player.getRanged();
      }
      if (player.hasMagic()) {
        e.player.magic = player.getMagic();
      }
      const equipmentDeltas = player.getEquipmentDeltasList();
      if (equipmentDeltas.length > 0) {
        e.player.equipmentDeltas = equipmentDeltas;
      }
      break;
    }

    case EventType.PLAYER_ATTACK: {
      const attack = evt.getPlayerAttack()!;
      const e = event as PlayerAttackEvent;
      e.player = { name: party[evt.getPlayer()!.getPartyIndex()] };
      e.attack = {
        type: attack.getType(),
        distanceToTarget: attack.getDistanceToTarget(),
      };

      if (attack.hasWeapon()) {
        const weapon = attack.getWeapon()!;
        // @ts-ignore: Name is populated on the frontend.
        e.attack.weapon = {
          id: weapon.getId(),
          quantity: weapon.getQuantity(),
        };
      }

      if (attack.hasTarget()) {
        const target = attack.getTarget()!;
        e.attack.target = {
          id: target.getId(),
          roomId: target.getRoomId(),
        };
      }
      break;
    }

    case EventType.PLAYER_DEATH: {
      const e = event as PlayerDeathEvent;
      e.player = { name: party[evt.getPlayer()!.getPartyIndex()] };
      break;
    }

    case EventType.NPC_SPAWN:
    case EventType.NPC_DEATH:
    case EventType.NPC_UPDATE:
    case EventType.TOB_MAIDEN_CRAB_LEAK: {
      const npc = evt.getNpc()!;
      const e = event as NpcEvent;
      e.npc = {
        id: npc.getId(),
        roomId: npc.getRoomId(),
        hitpoints: npc.getHitpoints(),
      };
      break;
    }

    case EventType.NPC_ATTACK: {
      const npc = evt.getNpc()!;
      const npcAttack = evt.getNpcAttack()!;
      const e = event as NpcAttackEvent;
      e.npc = {
        id: npc.getId(),
        roomId: npc.getRoomId(),
      };
      e.npcAttack = {
        attack: npcAttack.getAttack(),
      };

      if (evt.hasPlayer()) {
        e.npcAttack.target = party[evt.getPlayer()!.getPartyIndex()];
      } else if (npcAttack.hasTarget()) {
        e.npcAttack.target = npcAttack.getTarget();
      }
      break;
    }

    case EventType.TOB_MAIDEN_BLOOD_SPLATS: {
      const e = event as MaidenBloodSplatsEvent;
      e.maidenBloodSplats = evt.getMaidenBloodSplatsList().map((splat) => ({
        x: splat.getX(),
        y: splat.getY(),
      }));
      break;
    }

    case EventType.TOB_BLOAT_DOWN: {
      const bloatDown = evt.getBloatDown()!;
      const e = event as BloatDownEvent;
      e.bloatDown = {
        downNumber: bloatDown.getDownNumber(),
        walkTime: bloatDown.getWalkTime(),
      };
      break;
    }

    case EventType.TOB_NYLO_WAVE_SPAWN:
    case EventType.TOB_NYLO_WAVE_STALL: {
      const nyloWave = evt.getNyloWave()!;
      const e = event as NyloWaveStallEvent | NyloWaveSpawnEvent;
      e.nyloWave = {
        wave: nyloWave.getWave(),
        nylosAlive: nyloWave.getNylosAlive(),
        roomCap: nyloWave.getRoomCap(),
      };
      break;
    }

    case EventType.TOB_NYLO_CLEANUP_END:
    case EventType.TOB_NYLO_BOSS_SPAWN:
      // No extra data.
      break;

    case EventType.TOB_SOTE_MAZE_PROC:
    case EventType.TOB_SOTE_MAZE_END: {
      const maze = evt.getSoteMaze()!;
      const e = event as SoteMazeEvent;
      e.soteMaze = { maze: maze.getMaze() };
      break;
    }

    case EventType.TOB_SOTE_MAZE_PATH: {
      const maze = evt.getSoteMaze()!;
      const e = event as SoteMazePathEvent;
      e.soteMaze = {
        maze: maze.getMaze(),
        activeTiles: maze.getOverworldTilesList().map((tile) => ({
          x: tile.getX(),
          y: tile.getY(),
        })),
      };
      break;
    }

    case EventType.TOB_XARPUS_PHASE: {
      const e = event as XarpusPhaseEvent;
      e.xarpusPhase = evt.getXarpusPhase();
      break;
    }

    case EventType.TOB_VERZIK_PHASE: {
      const e = event as VerzikPhaseEvent;
      e.verzikPhase = evt.getVerzikPhase();
      break;
    }

    case EventType.CHALLENGE_START:
    case EventType.CHALLENGE_END:
    case EventType.CHALLENGE_UPDATE:
    case EventType.STAGE_UPDATE:
    case EventType.TOB_VERZIK_ATTACK_STYLE:
    case EventType.COLOSSEUM_HANDICAP_CHOICE:
      // These events are not serialized to the file.
      break;
  }

  return event as Event;
}
