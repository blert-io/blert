import {
  ChallengeMode,
  EventType,
  isColosseumStage,
  isCoxStage,
  isInfernoStage,
  isMokhaiotlStage,
  isToaStage,
  Npc,
  NpcAttack,
  NYLOCAS_WAVES,
  Stage,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { PlayerState, TickState, TickStateArray } from './tick-state';
import { AreaLike, chebyshev, coordsEqual, CoordsLike, inArea } from './world';

export const enum ConsistencyIssueType {
  INVALID_MOVEMENT = 'INVALID_MOVEMENT',
  INVALID_EVENT_SEQUENCE = 'INVALID_EVENT_SEQUENCE',
  BAD_DATA = 'BAD_DATA',
}

export type InvalidMovementIssue = {
  type: ConsistencyIssueType.INVALID_MOVEMENT;
  player: string;
  delta: { x: number; y: number };
  ticksSinceLast: number;
  lastTick: number;
  tick: number;
  start: { x: number; y: number };
  end: { x: number; y: number };
};

export type InvalidEventSequenceIssue = {
  type: ConsistencyIssueType.INVALID_EVENT_SEQUENCE;
  eventType: EventType;
  tick: number;
};

export type BadDataIssue = {
  type: ConsistencyIssueType.BAD_DATA;
  tick: number;
  message: string;
};

export type ConsistencyIssue =
  | InvalidMovementIssue
  | InvalidEventSequenceIssue
  | BadDataIssue;

/**
 * A consistency checker attempts to detect signs of lag or dropped ticks within
 * an event timeline for a stage.
 *
 * Each consistency checker should focus on identifying a specific type of issue
 * with multiple checkers being run conditionally based on the desired level of
 * scrutiny.
 *
 * Note that lag detection in the general case is impossible. The absence of
 * issues does not imply that a timeline is of high quality.
 */
export abstract class ConsistencyChecker {
  /**
   * Checks for any consistency issues in a timeline of states.
   *
   * @param ticks Tick states for the stage.
   * @returns Any consistency issues found in the timeline.
   */
  public abstract check(ticks: TickStateArray): ConsistencyIssue[];
}

// Tile to which players are teleported at the start of Sotetseg's maze.
const SOTETSEG_OVERWORLD_MAZE_START_TILE = { x: 3274, y: 4307 };
const SOTETSEG_ROOM_AREA = { x: 3271, y: 4304, width: 17, height: 30 };
const SOTETSEG_UNDERWORLD_AREA = { x: 3354, y: 4309, width: 14, height: 22 };

// Tiles within melee range of Verzik's fixed 3x3 P2 location.
const VERZIK_P2_BOUNCEABLE_AREA = { x: 3166, y: 4312, width: 5, height: 5 };
const VERZIK_P2_CENTER_TILE = { x: 3168, y: 4314 };

// Tiles within Verzik's 7x7 P3 location during webs.
const VERZIK_P3_WEBS_AREA = { x: 3165, y: 4309, width: 7, height: 7 };
const VERZIK_P3_WEBS_CENTER_TILE = { x: 3168, y: 4312 };

// Tile to which players are teleported at the start of Colosseum's boss fight.
const COLOSSEUM_BOSS_START_TILE = { x: 1825, y: 3103 };

function isValidP2BounceDestination(coords: CoordsLike): boolean {
  const distance = chebyshev(coords, VERZIK_P2_CENTER_TILE);
  return distance === 5 || distance === 6;
}

function isValidP3WebsPushDestination(coords: CoordsLike): boolean {
  return chebyshev(coords, VERZIK_P3_WEBS_CENTER_TILE) === 4;
}

function hasNpcAttack(
  tickState: TickState | null,
  idMatches: (id: number) => boolean,
  attackType: NpcAttack,
): boolean {
  for (const npc of tickState?.getNpcs().values() ?? []) {
    if (idMatches(npc.id) && npc.attack?.type === attackType) {
      return true;
    }
  }
  return false;
}

function checkForP3WebsPush(
  ticks: TickStateArray,
  tick: number,
  last: PlayerState,
  current: PlayerState,
): boolean {
  // When webs starts, players under Verzik are pushed directly outside of
  // her area.
  let isWebs = false;

  for (let t = tick; t >= Math.max(tick - 3, 0); t--) {
    const tickState = ticks[t];
    if (!tickState) {
      continue;
    }

    isWebs = hasNpcAttack(
      tickState,
      (id) => Npc.isVerzikP3(id),
      NpcAttack.TOB_VERZIK_P3_WEBS,
    );
    if (isWebs) {
      break;
    }
  }

  return (
    isWebs &&
    inArea(last, VERZIK_P3_WEBS_AREA) &&
    isValidP3WebsPushDestination(current)
  );
}

const DEATH_AREAS_BY_STAGE: Partial<Record<Stage, AreaLike[]>> = {
  [Stage.TOB_MAIDEN]: [
    { x: 3166, y: 4433, width: 2, height: 1 },
    { x: 3166, y: 4460, width: 2, height: 1 },
  ],
  [Stage.TOB_BLOAT]: [
    { x: 3295, y: 4436, width: 2, height: 1 },
    { x: 3295, y: 4459, width: 2, height: 1 },
  ],
  [Stage.TOB_NYLOCAS]: [
    { x: 3290, y: 4240, width: 1, height: 1 },
    { x: 3301, y: 4240, width: 1, height: 1 },
    { x: 3287, y: 4243, width: 1, height: 1 },
    { x: 3304, y: 4243, width: 1, height: 1 },
    { x: 3287, y: 4254, width: 1, height: 1 },
    { x: 3304, y: 4254, width: 1, height: 1 },
    { x: 3290, y: 4257, width: 1, height: 1 },
    { x: 3301, y: 4257, width: 1, height: 1 },
  ],
  [Stage.TOB_SOTETSEG]: [
    { x: 3270, y: 4313, width: 1, height: 2 },
    { x: 3289, y: 4313, width: 1, height: 2 },
  ],
  [Stage.TOB_XARPUS]: [{ x: 3156, y: 4381, width: 2, height: 13 }],
  [Stage.TOB_VERZIK]: [
    { x: 3157, y: 4325, width: 5, height: 1 },
    { x: 3175, y: 4325, width: 5, height: 1 },
  ],
};

function isInDeathArea(stage: Stage, coords: CoordsLike): boolean {
  return (
    DEATH_AREAS_BY_STAGE[stage]?.some((area) => inArea(coords, area)) ?? false
  );
}

/**
 * Detects invalid player movements that exceed the maximum possible distance
 * per tick, accounting for stage-specific teleports (Sotetseg maze, Verzik
 * bounce/webs, Colosseum boss cutscene, death areas).
 */
export class MovementConsistencyChecker extends ConsistencyChecker {
  private readonly stage: Stage;
  private readonly party: string[];

  public constructor(stage: Stage, party: string[]) {
    super();
    this.stage = stage;
    this.party = party;
  }

  public override check(ticks: TickStateArray): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];
    const lastPlayerStates: Record<
      string,
      (PlayerState & { tick: number }) | null
    > = {};
    for (const player of this.party) {
      lastPlayerStates[player] = null;
    }

    for (const tickState of ticks) {
      if (tickState === null) {
        continue;
      }

      const tick = tickState.getTick();

      for (const player of this.party) {
        const playerState = tickState.getPlayerState(player);
        if (playerState === null) {
          continue;
        }

        if (lastPlayerStates[player] !== null) {
          const last = lastPlayerStates[player];
          const ticksSinceLast = tick - last.tick;

          // Players can move at most 2 tiles per tick -- anything more is a
          // likely indication of tick loss.
          const maxDistance = 2 * ticksSinceLast;
          const invalidMove =
            !playerState.isDead &&
            chebyshev(playerState, last) > maxDistance &&
            !this.isSpecialTeleport(
              ticks,
              tick,
              last,
              playerState,
              ticksSinceLast,
            );

          if (invalidMove) {
            issues.push({
              type: ConsistencyIssueType.INVALID_MOVEMENT,
              player,
              delta: {
                x: playerState.x - last.x,
                y: playerState.y - last.y,
              },
              ticksSinceLast,
              lastTick: last.tick,
              tick,
              start: { x: last.x, y: last.y },
              end: { x: playerState.x, y: playerState.y },
            });
          }
        }

        lastPlayerStates[player] = { ...playerState, tick };
      }
    }

    return issues;
  }

  /**
   * Checks if a player's movement between two positions is a special teleport
   * within a specific boss fight.
   *
   * @param tick The tick at which the player's movement occurred.
   * @param last Player's last known state.
   * @param current Player's current state.
   * @param deltaTicks Number of ticks between the two states.
   * @returns Whether the player's movement between the two states is a teleport.
   */
  private isSpecialTeleport(
    ticks: TickStateArray,
    tick: number,
    last: PlayerState,
    current: PlayerState,
    deltaTicks: number,
  ): boolean {
    if (isInDeathArea(this.stage, current)) {
      return true;
    }

    if (isInfernoStage(this.stage)) {
      return false;
    }
    if (isMokhaiotlStage(this.stage)) {
      return false;
    }

    if (isColosseumStage(this.stage)) {
      if (this.stage === Stage.COLOSSEUM_WAVE_12) {
        // During the cutscene at the start of the boss, players remain on their
        // original tile, and then are teleported to the fight start tile when
        // the cutscene ends.
        return tick < 5 && coordsEqual(current, COLOSSEUM_BOSS_START_TILE);
      }
      return false;
    }

    switch (this.stage) {
      case Stage.TOB_SOTETSEG: {
        // Maze teleports between the overworld and underworld are special
        // teleports by definition.
        if (
          inArea(current, SOTETSEG_UNDERWORLD_AREA) &&
          inArea(last, SOTETSEG_ROOM_AREA)
        ) {
          return true;
        }
        if (
          inArea(current, SOTETSEG_ROOM_AREA) &&
          inArea(last, SOTETSEG_UNDERWORLD_AREA)
        ) {
          return true;
        }

        // Otherwise, the only special teleport that occurs is going from
        // anywhere in the room to the start of the maze when it procs. This
        // must be a one-tick movement.
        return (
          deltaTicks === 1 &&
          inArea(last, SOTETSEG_ROOM_AREA) &&
          coordsEqual(current, SOTETSEG_OVERWORLD_MAZE_START_TILE)
        );
      }

      case Stage.TOB_VERZIK: {
        if (deltaTicks !== 1) {
          return false;
        }

        // Check the previous tick's NPC because a bounce can happen right on a
        // phase transition.
        const verzikNpc = ticks[tick - 1]
          ?.getNpcs()
          .values()
          .find((npc) => Npc.isVerzik(npc.id));
        if (verzikNpc === undefined) {
          return false;
        }

        if (Npc.isVerzikP2(verzikNpc.id)) {
          return this.checkForP2Bounce(ticks, tick, last, current);
        }

        if (Npc.isVerzikP3(verzikNpc.id)) {
          return checkForP3WebsPush(ticks, tick, last, current);
        }

        return false;
      }

      case Stage.TOB_MAIDEN:
      case Stage.TOB_BLOAT:
      case Stage.TOB_NYLOCAS:
      case Stage.TOB_XARPUS:
        // These stages have no special teleports.
        return false;

      case Stage.UNKNOWN:
        return false;
    }

    // TODO(frolv): These challenges are not yet supported.
    if (isCoxStage(this.stage) || isToaStage(this.stage)) {
      return false;
    }

    const _exhaustive: never = this.stage;
    return false;
  }

  private checkForP2Bounce(
    ticks: TickStateArray,
    tick: number,
    last: PlayerState,
    current: PlayerState,
  ): boolean {
    // Verzik's bounce pushes a player away from under or adjacent to her.
    if (
      !inArea(last, VERZIK_P2_BOUNCEABLE_AREA) ||
      !isValidP2BounceDestination(current)
    ) {
      return false;
    }

    const potentialBounceTick = tick - 1;

    for (let t = potentialBounceTick; t <= tick + 5; t++) {
      const tickState = ticks[t];
      if (!tickState) {
        continue;
      }
      const event = tickState.getEventsByType(Event.Type.TOB_VERZIK_BOUNCE);
      if (event.length === 0) {
        continue;
      }
      const bounce = event[0].getVerzikBounce()!;
      const validTick =
        bounce.getNpcAttackTick() === potentialBounceTick ||
        bounce.getNpcAttackTick() === tick;
      if (validTick && bounce.getBouncedPlayer() === current.username) {
        return true;
      }
    }

    // It's possible for a client to miss the bounce event, in which case we
    // fall back to the presence of a bounce attack, which indicates that
    // Verzik performed the bounce animation, but without knowing the
    // target.
    //
    // Verzik's bounce targets a single player, so if the bounce attack is
    // present, we ensure that only the player we are checking made a
    // bounce-like movement.
    const hasBounce = (tickState: TickState | null): boolean => {
      return hasNpcAttack(
        tickState,
        (id) => Npc.isVerzikP2(id),
        NpcAttack.TOB_VERZIK_P2_BOUNCE,
      );
    };

    if (!hasBounce(ticks[potentialBounceTick]) && !hasBounce(ticks[tick])) {
      return false;
    }

    let bounceLikeMovements = 0;
    let playerWasBounced = false;

    for (const player of this.party) {
      const curr = ticks[tick]?.getPlayerState(player);
      const prev = ticks[tick - 1]?.getPlayerState(player);
      if (!curr || !prev) {
        continue;
      }

      if (
        inArea(prev, VERZIK_P2_BOUNCEABLE_AREA) &&
        isValidP2BounceDestination(curr)
      ) {
        bounceLikeMovements++;
        if (player === current.username) {
          playerWasBounced = true;
        }
      }
    }

    return playerWasBounced && bounceLikeMovements === 1;
  }
}

export class BloatConsistencyChecker extends ConsistencyChecker {
  private down: boolean;

  public constructor() {
    super();
    this.down = false;
  }

  public override check(ticks: TickStateArray): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];

    for (const tick of ticks) {
      if (tick === null) {
        continue;
      }
      const down = tick.getEventsByType(Event.Type.TOB_BLOAT_DOWN).length > 0;
      const up = tick.getEventsByType(Event.Type.TOB_BLOAT_UP).length > 0;
      if (down && up) {
        issues.push({
          type: ConsistencyIssueType.BAD_DATA,
          tick: tick.getTick(),
          message: 'Bloat down and up events on the same tick',
        });
        return issues;
      }

      if (down) {
        if (this.down) {
          issues.push({
            type: ConsistencyIssueType.INVALID_EVENT_SEQUENCE,
            eventType: Event.Type.TOB_BLOAT_DOWN,
            tick: tick.getTick(),
          });
        }
        this.down = true;
        continue;
      }

      if (up) {
        if (!this.down) {
          issues.push({
            type: ConsistencyIssueType.INVALID_EVENT_SEQUENCE,
            eventType: Event.Type.TOB_BLOAT_UP,
            tick: tick.getTick(),
          });
        }
        this.down = false;
      }
    }

    return issues;
  }
}

function isPrinceWave(wave: number): boolean {
  return wave === 10 || wave === 20 || wave === 30;
}

function sumNaturalStalls(
  mode: ChallengeMode,
  lastWave: number,
  wave: number,
): number {
  let sum = 0;
  for (let w = lastWave; w < wave; w++) {
    const stall =
      mode === ChallengeMode.TOB_HARD && isPrinceWave(w)
        ? 16
        : NYLOCAS_WAVES[w - 1].naturalStall;
    sum += stall;
  }
  return sum;
}

export class NylocasConsistencyChecker extends ConsistencyChecker {
  private readonly mode: ChallengeMode;
  private spawnTicks: number[];
  private lastWave: number;

  public constructor(mode: ChallengeMode) {
    super();
    this.mode = mode;
    this.spawnTicks = new Array<number>(31).fill(0);
    this.lastWave = 0;
  }

  public override check(ticks: TickStateArray): ConsistencyIssue[] {
    const issues: ConsistencyIssue[] = [];

    for (const tick of ticks) {
      if (tick === null) {
        continue;
      }

      const spawn = tick.getEventsByType(Event.Type.TOB_NYLO_WAVE_SPAWN);
      if (spawn.length === 0) {
        continue;
      }

      const wave = spawn[0].getNyloWave()?.getWave();
      if (wave === undefined) {
        continue;
      }

      if (wave < 1 || wave > 31) {
        issues.push({
          type: ConsistencyIssueType.BAD_DATA,
          tick: tick.getTick(),
          message: `Nylocas wave ${wave} out of range`,
        });
        return issues;
      }

      if (this.lastWave > 0) {
        if (wave <= this.lastWave) {
          issues.push({
            type: ConsistencyIssueType.BAD_DATA,
            tick: tick.getTick(),
            message: `Nylocas wave ${wave} after wave ${this.lastWave}`,
          });
          return issues;
        }

        const delta = tick.getTick() - this.spawnTicks[this.lastWave - 1];
        const minDelta = sumNaturalStalls(this.mode, this.lastWave, wave);
        if (delta < minDelta) {
          issues.push({
            type: ConsistencyIssueType.INVALID_EVENT_SEQUENCE,
            eventType: Event.Type.TOB_NYLO_WAVE_SPAWN,
            tick: tick.getTick(),
          });
        }
      }

      this.spawnTicks[wave - 1] = tick.getTick();
      this.lastWave = wave;
    }

    return issues;
  }
}

export function consistencyCheckerForStage(
  stage: Stage,
  mode: ChallengeMode,
): ConsistencyChecker | null {
  switch (stage) {
    case Stage.TOB_BLOAT:
      return new BloatConsistencyChecker();
    case Stage.TOB_NYLOCAS:
      return new NylocasConsistencyChecker(mode);
    default:
      return null;
  }
}
