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
  Stage,
} from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { PlayerState, TickState, TickStateArray } from './tick-state';
import {
  chebyshev,
  COLOSSEUM_BOSS_START_TILE,
  coordsEqual,
  inArea,
  isInDeathArea,
  isValidP2BounceDestination,
  isValidP3WebsPushDestination,
  SOTETSEG_OVERWORLD_MAZE_START_TILE,
  SOTETSEG_ROOM_AREA,
  SOTETSEG_UNDERWORLD_AREA,
  sumNaturalStalls,
  VERZIK_P2_BOUNCEABLE_AREA,
  VERZIK_P3_WEBS_AREA,
} from './world';

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

    const websAttack = tickState
      .getEventsByType(Event.Type.NPC_ATTACK)
      ?.find((evt) => {
        const attack = evt.getNpcAttack()!;
        return attack.getAttack() === NpcAttack.TOB_VERZIK_P3_WEBS;
      });
    if (websAttack !== undefined) {
      isWebs = true;
      break;
    }
  }

  return (
    isWebs &&
    inArea(last, VERZIK_P3_WEBS_AREA) &&
    isValidP3WebsPushDestination(current)
  );
}

/**
 * Detects invalid player movements that exceed the maximum possible distance
 * per tick, accounting for stage-specific teleports.
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
        const verzikEntry = ticks[tick - 1]
          ?.getNpcs()
          .entries()
          .find(([_, npc]) => Npc.isVerzik(npc.id));
        if (verzikEntry === undefined) {
          return false;
        }
        const [verzikRoomId, verzikNpc] = verzikEntry;

        if (Npc.isVerzikP2(verzikNpc.id)) {
          return this.checkForP2Bounce(
            verzikRoomId,
            ticks,
            tick,
            last,
            current,
          );
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
    verzikRoomId: number,
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

    // It's possible for a client to not send a bounce event, which could happen
    // in two ways:
    //
    // 1. The bounce occurred right at the transition from P2 to P3, so Verzik's
    //    bounce animation was superseded by the transition animation.
    // 2. The plugin didn't attribute the bounce event due to its state machine
    //    becoming desynced. In this case, the client should still have sent a
    //    bounce attack for Verzik.
    //
    // In both cases, the target of the bounce is not known. However, since it's
    // single-target, we can check that only the player we are testing made a
    // bounce-like movement and allow it if so.
    const hasBounce = (tickState: TickState | null): boolean => {
      return (
        tickState?.getEventsByType(Event.Type.NPC_ATTACK)?.find((evt) => {
          const attack = evt.getNpcAttack()!;
          return attack.getAttack() === NpcAttack.TOB_VERZIK_P2_BOUNCE;
        }) !== undefined
      );
    };

    let isAtP3Transition = false;
    const verzik = ticks[tick + 1]?.getNpcs().get(verzikRoomId);
    if (verzik !== undefined && Npc.isVerzikP3Transition(verzik.id)) {
      isAtP3Transition = true;
    }

    if (
      !isAtP3Transition &&
      !hasBounce(ticks[potentialBounceTick]) &&
      !hasBounce(ticks[tick])
    ) {
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
