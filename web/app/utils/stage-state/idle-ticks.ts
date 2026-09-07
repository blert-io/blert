import { PlayerStateMap } from './types';

export type IdleTickCount = {
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
 * not between their first and last attacks. Idle ticks are grouped into
 * periods of consecutive runs.
 *
 * A player without attacks counts every valid tick.
 */
export function computeIdleTickCounts(
  playerState: PlayerStateMap,
): Map<string, IdleTickCount> {
  const counts = new Map<string, IdleTickCount>();

  for (const [player, states] of playerState) {
    let firstAttackTick = -1;
    let lastAttackTick = Infinity;
    for (let tick = 0; tick < states.length; tick++) {
      if (states[tick]?.attack !== undefined) {
        if (firstAttackTick === -1) {
          firstAttackTick = tick;
        }
        lastAttackTick = tick;
      }
    }

    const start = Math.max(1, firstAttackTick);
    const end = Math.min(lastAttackTick, states.length - 1);
    let idleTicks = 0;
    let eligibleTicks = 0;
    let longestIdle = 0;
    let idlePeriods = 0;
    let currentRun = 0;

    for (let tick = start; tick <= end; tick++) {
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

    counts.set(player, { idleTicks, eligibleTicks, longestIdle, idlePeriods });
  }

  return counts;
}
