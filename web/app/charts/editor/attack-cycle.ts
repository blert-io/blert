/** Attack cycle derivation over BCF documents. */

import {
  BCFAction,
  BCFAttackAction,
  BCFResolver,
  BlertChartFormat,
} from '@blert/bcf';
import { attackDefinitionsById } from '@blert/common';

import { bcfToPlayerAttack } from '@/components/attack-timeline';

/** Returns the cooldown of the attack identified by `attackType`. */
export function attackCooldown(attackType: string): number {
  return (
    attackDefinitionsById.get(bcfToPlayerAttack(attackType))?.cooldown ?? 1
  );
}

/** Returns the special attack energy cost of `attackType`, if it has one. */
export function specCost(attackType: string): number | undefined {
  return attackDefinitionsById.get(bcfToPlayerAttack(attackType))?.specCost;
}

/** An attack placed before its actor is off cooldown. */
export type CooldownConflict = {
  actorId: string;
  tick: number;
  offCooldownTick: number;
};

function isAttack(action: BCFAction): action is BCFAttackAction {
  return action.type === 'attack';
}

/**
 * Adds `offCooldown` state to every actor in `bcf`.
 * Returns any attacks placed before their actor was off cooldown.
 */
export function deriveState(bcf: BlertChartFormat): CooldownConflict[] {
  const { totalTicks } = bcf.config;

  const offCooldownTicks = new Map<string, number>();
  for (const actor of bcf.timeline.actors) {
    if (actor.type === 'player') {
      offCooldownTicks.set(actor.id, 0);
    }
  }

  const conflicts: CooldownConflict[] = [];
  const free = new Map<number, string[]>();

  function markFree(actorId: string, from: number, to: number): void {
    for (let tick = from; tick < to; tick++) {
      const actorIds = free.get(tick);
      if (actorIds === undefined) {
        free.set(tick, [actorId]);
      } else {
        actorIds.push(actorId);
      }
    }
  }

  for (const entry of bcf.timeline.ticks) {
    for (const cell of entry.cells) {
      const offCooldown = offCooldownTicks.get(cell.actorId) ?? 0;

      const attack = cell.actions?.find(isAttack);
      if (attack === undefined) {
        continue;
      }

      if (entry.tick < offCooldown) {
        conflicts.push({
          actorId: cell.actorId,
          tick: entry.tick,
          offCooldownTick: offCooldown,
        });
      }
      markFree(cell.actorId, offCooldown, entry.tick);

      offCooldownTicks.set(
        cell.actorId,
        Math.max(offCooldown, entry.tick + attackCooldown(attack.attackType)),
      );
    }
  }

  for (const [actorId, offCooldown] of offCooldownTicks) {
    markFree(actorId, offCooldown, totalTicks);
  }

  const entries = new Map(bcf.timeline.ticks.map((e) => [e.tick, e]));
  for (const [tick, actorIds] of free) {
    let entry = entries.get(tick);
    if (entry === undefined) {
      entry = { tick, cells: [] };
      entries.set(tick, entry);
    }

    for (const actorId of actorIds) {
      const cell = entry.cells.find((c) => c.actorId === actorId);
      if (cell === undefined) {
        entry.cells.push({ actorId, state: { offCooldown: true } });
      } else {
        cell.state = { ...cell.state, offCooldown: true };
      }
    }
  }

  bcf.timeline.ticks = entries
    .values()
    .toArray()
    .sort((a, b) => a.tick - b.tick);
  return conflicts;
}

/**
 * Returns the nearest tick after `tick` (or before it, going `backward`) at
 * which player `actorId` is off cooldown.
 * State must be present in the chart. See {@link deriveState}.
 */
export function findOffCooldownTick(
  resolver: BCFResolver,
  actorId: string,
  tick: number,
  direction: 'forward' | 'backward',
): number | null {
  const step = direction === 'forward' ? 1 : -1;
  for (let t = tick + step; ; t += step) {
    const state = resolver.getPlayerState(actorId, t);
    if (state === undefined) {
      return null;
    }
    if (state.offCooldown === true) {
      return t;
    }
  }
}
