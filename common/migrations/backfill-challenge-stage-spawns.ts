import postgres from 'postgres';
import { parseArgs } from 'util';

import {
  dataRepositoryFromEnv,
  forEachChallengeWithData,
} from './script-helpers';
import {
  ChallengeType,
  ColosseumData,
  Handicap,
  InfernoData,
  RoomNpc,
  Stage,
  handicapBase,
} from '../challenge';
import { DataRepository } from '../data-repository/data-repository';
import { Coords } from '../event';
import { Event as EventProto } from '../generated/event_pb';
import { NpcId } from '../npcs/npc-id';

type Arena = {
  base: Coords;
  spawnLocations: Coords[];
  npcTypes: NpcId[];
};

const COLOSSEUM_ARENA: Arena = {
  base: { x: 1808, y: 3123 },
  spawnLocations: [
    { x: 1811, y: 3109 },
    { x: 1817, y: 3106 },
    { x: 1825, y: 3114 },
    { x: 1821, y: 3109 },
    { x: 1827, y: 3109 },
    { x: 1836, y: 3109 },
    { x: 1832, y: 3107 },
    { x: 1811, y: 3104 },
    { x: 1836, y: 3104 },
    { x: 1821, y: 3103 },
    { x: 1827, y: 3103 },
    { x: 1824, y: 3099 },
  ],
  npcTypes: [
    NpcId.SERPENT_SHAMAN,
    NpcId.JAVELIN_COLOSSUS,
    NpcId.MANTICORE,
    NpcId.SHOCKWAVE_COLOSSUS,
  ],
};

const INFERNO_ARENA: Arena = {
  base: { x: 2257, y: 5358 },
  spawnLocations: [
    { x: 2258, y: 5330 },
    { x: 2262, y: 5335 },
    { x: 2272, y: 5330 },
    { x: 2258, y: 5353 },
    { x: 2273, y: 5341 },
    { x: 2279, y: 5353 },
    { x: 2260, y: 5347 },
    { x: 2280, y: 5333 },
    { x: 2280, y: 5346 },
  ],
  npcTypes: [
    NpcId.JAL_MEJRAH,
    NpcId.JAL_AK,
    NpcId.JAL_IMKOT,
    NpcId.JAL_XIL,
    NpcId.JAL_ZEK,
  ],
};

const { SERPENT_SHAMAN, JAVELIN_COLOSSUS, MANTICORE, SHOCKWAVE_COLOSSUS } =
  NpcId;

const COLOSSEUM_WAVES: NpcId[][] = [
  [SERPENT_SHAMAN],
  [SERPENT_SHAMAN, JAVELIN_COLOSSUS],
  [SERPENT_SHAMAN, JAVELIN_COLOSSUS, JAVELIN_COLOSSUS],
  [SERPENT_SHAMAN, MANTICORE],
  [SERPENT_SHAMAN, JAVELIN_COLOSSUS, MANTICORE],
  [SERPENT_SHAMAN, JAVELIN_COLOSSUS, JAVELIN_COLOSSUS, MANTICORE],
  [JAVELIN_COLOSSUS, MANTICORE, SHOCKWAVE_COLOSSUS],
  [JAVELIN_COLOSSUS, JAVELIN_COLOSSUS, MANTICORE, SHOCKWAVE_COLOSSUS],
  [JAVELIN_COLOSSUS, MANTICORE, MANTICORE],
  [JAVELIN_COLOSSUS, JAVELIN_COLOSSUS, MANTICORE, MANTICORE],
  [JAVELIN_COLOSSUS, MANTICORE, MANTICORE, SHOCKWAVE_COLOSSUS],
  [],
];

const { JAL_MEJRAH, JAL_AK, JAL_IMKOT, JAL_XIL, JAL_ZEK } = NpcId;

const INFERNO_WAVES: NpcId[][] = [
  [JAL_MEJRAH],
  [JAL_MEJRAH, JAL_MEJRAH],
  [],
  [JAL_AK],
  [JAL_AK, JAL_MEJRAH],
  [JAL_AK, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_AK, JAL_AK],
  [],
  [JAL_IMKOT],
  [JAL_IMKOT, JAL_MEJRAH],
  [JAL_IMKOT, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_IMKOT, JAL_AK],
  [JAL_IMKOT, JAL_AK, JAL_MEJRAH],
  [JAL_IMKOT, JAL_AK, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_IMKOT, JAL_AK, JAL_AK],
  [JAL_IMKOT, JAL_IMKOT],
  [],
  [JAL_XIL],
  [JAL_XIL, JAL_MEJRAH],
  [JAL_XIL, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_XIL, JAL_AK],
  [JAL_XIL, JAL_AK, JAL_MEJRAH],
  [JAL_XIL, JAL_AK, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_XIL, JAL_AK, JAL_AK],
  [JAL_XIL, JAL_IMKOT],
  [JAL_XIL, JAL_IMKOT, JAL_MEJRAH],
  [JAL_XIL, JAL_IMKOT, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_XIL, JAL_IMKOT, JAL_AK],
  [JAL_XIL, JAL_IMKOT, JAL_AK, JAL_MEJRAH],
  [JAL_XIL, JAL_IMKOT, JAL_AK, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_XIL, JAL_IMKOT, JAL_AK, JAL_AK],
  [JAL_XIL, JAL_IMKOT, JAL_IMKOT],
  [JAL_XIL, JAL_XIL],
  [],
  [JAL_ZEK],
  [JAL_ZEK, JAL_MEJRAH],
  [JAL_ZEK, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_ZEK, JAL_AK],
  [JAL_ZEK, JAL_AK, JAL_MEJRAH],
  [JAL_ZEK, JAL_AK, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_ZEK, JAL_AK, JAL_AK],
  [JAL_ZEK, JAL_IMKOT],
  [JAL_ZEK, JAL_IMKOT, JAL_MEJRAH],
  [JAL_ZEK, JAL_IMKOT, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_ZEK, JAL_IMKOT, JAL_AK],
  [JAL_ZEK, JAL_IMKOT, JAL_AK, JAL_MEJRAH],
  [JAL_ZEK, JAL_IMKOT, JAL_AK, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_ZEK, JAL_IMKOT, JAL_AK, JAL_AK],
  [JAL_ZEK, JAL_IMKOT, JAL_IMKOT],
  [JAL_ZEK, JAL_XIL],
  [JAL_ZEK, JAL_XIL, JAL_MEJRAH],
  [JAL_ZEK, JAL_XIL, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_ZEK, JAL_XIL, JAL_AK],
  [JAL_ZEK, JAL_XIL, JAL_AK, JAL_MEJRAH],
  [JAL_ZEK, JAL_XIL, JAL_AK, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_ZEK, JAL_XIL, JAL_AK, JAL_AK],
  [JAL_ZEK, JAL_XIL, JAL_IMKOT],
  [JAL_ZEK, JAL_XIL, JAL_IMKOT, JAL_MEJRAH],
  [JAL_ZEK, JAL_XIL, JAL_IMKOT, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_ZEK, JAL_XIL, JAL_IMKOT, JAL_AK],
  [JAL_ZEK, JAL_XIL, JAL_IMKOT, JAL_AK, JAL_MEJRAH],
  [JAL_ZEK, JAL_XIL, JAL_IMKOT, JAL_AK, JAL_MEJRAH, JAL_MEJRAH],
  [JAL_ZEK, JAL_XIL, JAL_IMKOT, JAL_AK, JAL_AK],
  [JAL_ZEK, JAL_XIL, JAL_IMKOT, JAL_IMKOT],
  [JAL_ZEK, JAL_XIL, JAL_XIL],
  [JAL_ZEK, JAL_ZEK],
  [],
  [],
  [],
];

function waveSpawn(
  arena: Arena,
  expected: number[],
  extra: number[],
  npcs: RoomNpc[],
): { spawns: number[]; tick: number } | null {
  if (expected.length === 0 || npcs.length === 0) {
    return null;
  }

  const firstTick = Math.min(...npcs.map((npc) => npc.spawnTick));
  const spawns = npcs.filter((npc) => npc.spawnTick === firstTick);

  const matched: RoomNpc[] = [];
  for (const id of expected) {
    const index = spawns.findIndex(
      (npc) =>
        npc.spawnNpcId === id &&
        arena.spawnLocations.some(
          (tile) => tile.x === npc.spawnPoint.x && tile.y === npc.spawnPoint.y,
        ),
    );
    if (index === -1) {
      return null;
    }
    matched.push(...spawns.splice(index, 1));
  }
  for (const id of extra) {
    const index = spawns.findIndex((npc) => npc.spawnNpcId === id);
    if (index === -1) {
      return null;
    }
    matched.push(...spawns.splice(index, 1));
  }

  if (spawns.some((npc) => arena.npcTypes.includes(npc.spawnNpcId))) {
    return null;
  }

  const values = matched
    .map((npc) => {
      const type = arena.npcTypes.indexOf(npc.spawnNpcId);
      const x = npc.spawnPoint.x - arena.base.x;
      const y = arena.base.y - npc.spawnPoint.y;
      return (type << 10) | (x << 5) | y;
    })
    .sort((a, b) => a - b);

  return { spawns: values, tick: firstTick };
}

async function wavePlayer(
  dataRepository: DataRepository,
  uuid: string,
  arena: Arena,
  stage: Stage,
  tick: number,
): Promise<number | null> {
  let events: EventProto[];
  try {
    events = await dataRepository.loadStageEvents(uuid, stage);
  } catch {
    return null;
  }

  const update = events.find(
    (event) =>
      event.getType() === EventProto.Type.PLAYER_UPDATE &&
      event.getTick() === tick,
  );
  if (update === undefined) {
    return null;
  }

  const x = update.getXCoord() - arena.base.x;
  const y = arena.base.y - update.getYCoord();
  return (y << 8) | x;
}

export async function scriptMain(sql: postgres.Sql, args: string[]) {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'batch-size': { type: 'string', default: '100' },
      'start-id': { type: 'string' },
      'end-id': { type: 'string' },
    },
    args,
  });

  const dryRun = values['dry-run'];

  const dataRepository = dataRepositoryFromEnv();

  const options = {
    batchSize: parseInt(values['batch-size']),
    startId: values['start-id'] ? parseInt(values['start-id']) : undefined,
    endId: values['end-id'] ? parseInt(values['end-id']) : undefined,
    types: [ChallengeType.COLOSSEUM, ChallengeType.INFERNO],
  };

  await forEachChallengeWithData(
    sql,
    dataRepository,
    async (challenge, data) => {
      const rows: {
        stage: Stage;
        spawns: number[] | null;
        player: number | null;
        modified: boolean;
      }[] = [];

      if (challenge.type === ChallengeType.COLOSSEUM) {
        let dynamicDuo = false;
        for (const wave of (data as ColosseumData).waves) {
          if (handicapBase(wave.handicap) === Handicap.DYNAMIC_DUO) {
            dynamicDuo = true;
          }
          const expected =
            COLOSSEUM_WAVES[wave.stage - Stage.COLOSSEUM_WAVE_1] ?? [];
          const extra =
            dynamicDuo && expected.includes(SHOCKWAVE_COLOSSUS)
              ? [SHOCKWAVE_COLOSSUS]
              : [];
          const spawn = waveSpawn(
            COLOSSEUM_ARENA,
            expected,
            extra,
            Object.values(wave.npcs),
          );
          const player =
            spawn === null
              ? null
              : await wavePlayer(
                  dataRepository,
                  challenge.uuid,
                  COLOSSEUM_ARENA,
                  wave.stage,
                  spawn.tick,
                );
          rows.push({
            stage: wave.stage,
            spawns: spawn?.spawns ?? null,
            player,
            modified: extra.length > 0,
          });
        }
      } else {
        for (const wave of (data as InfernoData).waves) {
          const expected =
            INFERNO_WAVES[wave.stage - Stage.INFERNO_WAVE_1] ?? [];
          const spawn = waveSpawn(
            INFERNO_ARENA,
            expected,
            [],
            Object.values(wave.npcs),
          );
          const player =
            spawn === null
              ? null
              : await wavePlayer(
                  dataRepository,
                  challenge.uuid,
                  INFERNO_ARENA,
                  wave.stage,
                  spawn.tick,
                );
          rows.push({
            stage: wave.stage,
            spawns: spawn?.spawns ?? null,
            player,
            modified: false,
          });
        }
      }

      if (dryRun) {
        console.log(`Challenge ${challenge.id} [${challenge.uuid}]:`, rows);
        return;
      }

      for (const row of rows) {
        await sql`
          INSERT INTO challenge_stage_spawns (challenge_id, stage, spawns, player, modified)
          VALUES (${challenge.id}, ${row.stage}, ${row.spawns}::smallint[], ${row.player}, ${row.modified})
          ON CONFLICT (challenge_id, stage) DO NOTHING
        `;
      }
    },
    options,
  );
}
