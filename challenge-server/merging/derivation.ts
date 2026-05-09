import { ChallengeMode, Maze, Npc, Stage } from '@blert/common';
import { Event, StageMap } from '@blert/common/generated/event_pb';

import { MergeContext } from './context';
import {
  NpcState,
  TickState,
  TickStateArray,
  WithProvenance,
} from './tick-state';
import { SotePivotTrace } from './trace';
import {
  CoordKey,
  CoordsLike,
  coordKey,
  naturalStallForWave,
  protoCoords,
} from './world';

/**
 * A derived event generator emits events that are recomputed from the final
 * merged timeline rather than reconciled from client streams.
 *
 * Generators run after consolidation and resynchronization, mutating the
 * timeline in place to insert their events.
 */
export abstract class DerivedEventGenerator {
  /**
   * Walks the merged timeline and inserts derived events.
   *
   * @param ticks Tick states for the stage.
   */
  public abstract derive(ticks: TickStateArray): void;
}

const FINAL_NYLO_WAVE = 31;
const NYLO_WAVE_CYCLE = 4;

type ProtoStage = StageMap[keyof StageMap];

function findBossNpc(tickState: TickState): NpcState | undefined {
  for (const npc of tickState.getNpcs().values()) {
    if (
      Npc.isNylocasVasilias(npc.id) ||
      Npc.isNylocasVasiliasDropping(npc.id)
    ) {
      return npc;
    }
  }
  return undefined;
}

function countNylosAlive(tickState: TickState): number {
  let nylosAlive = 0;
  for (const npc of tickState.getNpcs().values()) {
    if (Npc.isNylocas(npc.id)) {
      nylosAlive++;
    } else if (Npc.isNylocasPrinkipas(npc.id)) {
      nylosAlive += 3;
    }
  }
  return nylosAlive;
}

export class NylocasDerivedEvents extends DerivedEventGenerator {
  protected readonly mode: ChallengeMode;

  public constructor(mode: ChallengeMode) {
    super();
    this.mode = mode;
  }

  public override derive(ticks: TickStateArray): void {
    let wave = 0;
    let roomCap = 0;
    let nextStallTick = -1;

    for (let t = 0; t < ticks.length; t++) {
      const tick = ticks[t];

      if (tick !== null) {
        const boss = findBossNpc(tick);
        if (boss !== undefined) {
          this.emit(tick, this.bossSpawnEvent(boss));
          return;
        }

        const spawn = tick.getEventsByType(Event.Type.TOB_NYLO_WAVE_SPAWN)[0];
        if (spawn !== undefined) {
          const nyloWave = spawn.getNyloWave()!;
          wave = nyloWave.getWave();
          roomCap = nyloWave.getRoomCap();
          nextStallTick =
            spawn.getTick() + naturalStallForWave(this.mode, wave);
          continue;
        }
      }

      if (wave === FINAL_NYLO_WAVE) {
        if (tick !== null && countNylosAlive(tick) === 0) {
          this.emit(tick, this.basicEvent(Event.Type.TOB_NYLO_CLEANUP_END));
          wave = 0;
          nextStallTick = -1;
          continue;
        }
      } else if (t === nextStallTick) {
        nextStallTick += NYLO_WAVE_CYCLE;
        let target = tick;
        if (target === null) {
          target = new TickState(t, [], new Map(), new Map(), new Map());
          ticks[t] = target;
        }
        this.emit(target, this.stallEvent(target, wave, roomCap));
      }
    }
  }

  private basicEvent(type: Event.TypeMap[keyof Event.TypeMap]): Event {
    const event = new Event();
    event.setType(type);
    event.setStage(Stage.TOB_NYLOCAS as ProtoStage);
    return event;
  }

  private stallEvent(
    tickState: TickState,
    wave: number,
    roomCap: number,
  ): Event {
    const event = this.basicEvent(Event.Type.TOB_NYLO_WAVE_STALL);
    const nyloWave = new Event.NyloWave();
    nyloWave.setWave(wave);
    nyloWave.setNylosAlive(countNylosAlive(tickState));
    nyloWave.setRoomCap(roomCap);
    event.setNyloWave(nyloWave);
    return event;
  }

  private bossSpawnEvent(boss: NpcState): Event {
    const event = this.basicEvent(Event.Type.TOB_NYLO_BOSS_SPAWN);
    event.setXCoord(boss.x);
    event.setYCoord(boss.y);
    return event;
  }

  private emit(tickState: TickState, event: Event): void {
    event.setTick(tickState.getTick());
    tickState.addSyntheticEvents([event]);
  }
}

export class VerzikDerivedEvents extends DerivedEventGenerator {
  public override derive(ticks: TickStateArray): void {
    for (const tick of ticks) {
      if (tick === null) {
        continue;
      }

      const hasRedSpawn = tick
        .getEventsByType(Event.Type.NPC_SPAWN)
        .some((event) => {
          const npc = event.getNpc();
          return npc !== undefined && Npc.isVerzikMatomenos(npc.getId());
        });

      if (hasRedSpawn) {
        const event = new Event();
        event.setType(Event.Type.TOB_VERZIK_REDS_SPAWN);
        event.setStage(Stage.TOB_VERZIK as ProtoStage);
        event.setTick(tick.getTick());
        tick.addSyntheticEvents([event]);
        return;
      }
    }
  }
}

export function derivedEventGeneratorForStage(
  stage: Stage,
  mode: ChallengeMode,
): DerivedEventGenerator | null {
  switch (stage) {
    case Stage.TOB_NYLOCAS:
      return new NylocasDerivedEvents(mode);
    case Stage.TOB_VERZIK:
      return new VerzikDerivedEvents();
    default:
      return null;
  }
}

/**
 * Merges per-client stage-scoped data (collected on each `ClientEvents` at
 * ingestion) into the final timeline.
 */
export function mergeStageData(ctx: MergeContext, ticks: TickStateArray): void {
  switch (ctx.stage) {
    case Stage.TOB_SOTETSEG:
      mergeSotePivots(ctx, ticks);
      break;
  }
}

/**
 * Unions Sotetseg pivot observations across all clients and emits one
 * consolidated `TOB_SOTE_MAZE_PATH` event per maze at that maze's
 * `TOB_SOTE_MAZE_END` tick. First observer wins per coord; the source
 * client id is captured for trace provenance.
 */
function mergeSotePivots(ctx: MergeContext, ticks: TickStateArray): void {
  type MazePivots = {
    overworld: Map<CoordKey, WithProvenance<CoordsLike>>;
    underworld: Map<CoordKey, WithProvenance<CoordsLike>>;
  };
  const byMaze = new Map<Maze, MazePivots>();

  for (const [clientId, { client }] of ctx.clients) {
    for (const pivot of client.getStageData().sotePivots) {
      let entry = byMaze.get(pivot.maze);
      if (entry === undefined) {
        entry = { overworld: new Map(), underworld: new Map() };
        byMaze.set(pivot.maze, entry);
      }
      for (const c of pivot.overworld) {
        const key = coordKey(c);
        if (!entry.overworld.has(key)) {
          entry.overworld.set(key, { ...c, sourceClientId: clientId });
        }
      }
      for (const c of pivot.underworld) {
        const key = coordKey(c);
        if (!entry.underworld.has(key)) {
          entry.underworld.set(key, { ...c, sourceClientId: clientId });
        }
      }
    }
  }

  if (byMaze.size === 0) {
    return;
  }

  const mazeEndTicks = new Map<Maze, number>();
  for (let t = 0; t < ticks.length; t++) {
    const tick = ticks[t];
    if (tick === null) {
      continue;
    }
    for (const event of tick.getEventsByType(Event.Type.TOB_SOTE_MAZE_END)) {
      const maze = event.getSoteMaze()?.getMaze();
      if (maze !== undefined) {
        mazeEndTicks.set(maze as Maze, t);
      }
    }
  }

  const traces: SotePivotTrace[] = [];

  for (const [maze, pivots] of byMaze) {
    const overworld = [...pivots.overworld.values()].sort(
      (a, b) => a.y - b.y,
    );
    const underworld = [...pivots.underworld.values()].sort(
      (a, b) => a.y - b.y,
    );

    const endTickIdx = mazeEndTicks.get(maze);
    const tickState = endTickIdx !== undefined ? ticks[endTickIdx] : null;
    let emittedAtTick: number | null = null;

    if (endTickIdx !== undefined && tickState !== null) {
      const event = new Event();
      event.setType(Event.Type.TOB_SOTE_MAZE_PATH);
      event.setStage(Stage.TOB_SOTETSEG as ProtoStage);
      event.setTick(endTickIdx);

      const soteMaze = new Event.SoteMaze();
      soteMaze.setMaze(
        maze as Event.SoteMaze.MazeMap[keyof Event.SoteMaze.MazeMap],
      );
      soteMaze.setOverworldPivotsList(overworld.map(protoCoords));
      soteMaze.setUnderworldPivotsList(underworld.map(protoCoords));
      event.setSoteMaze(soteMaze);

      tickState.addSyntheticEvents([event]);
      emittedAtTick = endTickIdx;
    }

    traces.push({
      maze,
      emittedAtTick,
      merged: { overworld, underworld },
    });
  }

  ctx.tracer?.recordSotePivots(traces);
}
