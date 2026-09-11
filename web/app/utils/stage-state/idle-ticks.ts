import { PlayerStateMap } from './types';

export type IdleTickCount = {
  /** First tick of the counting window. */
  startTick: number;
  /** Ticks on which the player was off cooldown but did not attack. */
  idleTicks: number;
  /** Alive, observed ticks within the counting window. */
  eligibleTicks: number;
  /** Length of the longest consecutive run of idle ticks. */
  longestIdle: number;
  /** Number of distinct consecutive runs of idle ticks. */
  idlePeriods: number;
};

/**
 * Counts the number of ticks on which each player could have attacked but did
 * not, up to their final attack. Idle ticks are grouped into periods of
 * consecutive runs.
 *
 * Counting starts at `firstTick`, or at the player's first attack if it comes
 * earlier. A player without attacks counts every valid tick from `firstTick`.
 */
export function computeIdleTickCounts(
  playerState: PlayerStateMap,
  firstTick: number = 1,
): Map<string, IdleTickCount> {
  const counts = new Map<string, IdleTickCount>();

  for (const [player, states] of playerState) {
    let firstAttackTick = Infinity;
    let lastAttackTick = Infinity;
    for (let tick = 0; tick < states.length; tick++) {
      if (states[tick]?.attack !== undefined) {
        if (firstAttackTick === Infinity) {
          firstAttackTick = tick;
        }
        lastAttackTick = tick;
      }
    }

    const startTick = Math.min(firstTick, firstAttackTick);
    const end = Math.min(lastAttackTick, states.length - 1);
    let idleTicks = 0;
    let eligibleTicks = 0;
    let longestIdle = 0;
    let idlePeriods = 0;
    let currentRun = 0;

    for (let tick = startTick; tick <= end; tick++) {
      const state = states[tick];
      if (state === null || state.isDead) {
        currentRun = 0;
        continue;
      }

      eligibleTicks++;

      if (state.attack === undefined && state.player.offCooldownTick <= tick) {
        idleTicks++;
        currentRun++;
        if (currentRun === 1) {
          idlePeriods++;
        }
        longestIdle = Math.max(longestIdle, currentRun);
      } else {
        currentRun = 0;
      }
    }

    counts.set(player, {
      startTick,
      idleTicks,
      eligibleTicks,
      longestIdle,
      idlePeriods,
    });
  }

  return counts;
}
