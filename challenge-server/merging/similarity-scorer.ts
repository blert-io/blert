import { EquipmentSlot, Npc } from '@blert/common';
import { Event } from '@blert/common/generated/event_pb';

import { TickState, NpcState } from './tick-state';

const VISIBLE_EQUIPMENT_SLOTS: EquipmentSlot[] = [
  EquipmentSlot.HEAD,
  EquipmentSlot.CAPE,
  EquipmentSlot.AMULET,
  EquipmentSlot.WEAPON,
  EquipmentSlot.TORSO,
  EquipmentSlot.SHIELD,
  EquipmentSlot.LEGS,
  EquipmentSlot.GLOVES,
  EquipmentSlot.BOOTS,
];

// Values determined purely based off vibes, or as software engineers like to
// call them, "heuristics".
const ScoringConstants = {
  // Hitpoints are fuzzy and there can a many NPCs in a room, so score lower.
  COMPONENT_HITPOINTS_WEIGHT: 0.15,
  HITPOINTS_VARBIT_K: 50,
  HITPOINTS_VARBIT_WEIGHT: 10,
  HITPOINTS_REGULAR_K: 5,
  HITPOINTS_REGULAR_WEIGHT: 2,
  HITPOINTS_DELTA_THRESHOLD: 0.4,
  HITPOINTS_MAX_SCORE: 10,

  COMPONENT_ATTACKS_WEIGHT: 0.5,
  PLAYER_ATTACK_CONTRADICTORY_PENALTY: -10,
  PLAYER_ATTACK_POSITIVE_SIGNAL: 2,
  PLAYER_ATTACK_WEAK_POSITIVE_SIGNAL: 0.5,
  PLAYER_ATTACK_WEAK_NEGATIVE_SIGNAL: -0.2,
  PLAYER_ATTACK_MAX_SCORE: 10,
  PLAYER_ATTACK_MIN_SCORE: -20,

  // There are generally fewer NPC attacks than player attacks, so score higher.
  NPC_ATTACK_CONTRADICTORY_PENALTY: -10,
  NPC_ATTACK_POSITIVE_SIGNAL: 4,
  NPC_ATTACK_WEAK_POSITIVE_SIGNAL: 1,
  NPC_ATTACK_WEAK_NEGATIVE_SIGNAL: -0.5,
  NPC_ATTACK_MAX_SCORE: 10,
  NPC_ATTACK_MIN_SCORE: -10,

  // Overhead prayers are visible to all clients and should match.
  COMPONENT_PRAYERS_WEIGHT: 0.2,
  PRAYERS_POSITIVE_SIGNAL: 1,
  PRAYERS_NEGATIVE_SIGNAL: -1,
  PRAYERS_MAX_SCORE: 5,
  PRAYERS_MIN_SCORE: -5,

  COMPONENT_DEATHS_WEIGHT: 0.1,
  PLAYER_DEATH_POSITIVE_SIGNAL: 0.5,
  NPC_DEATH_POSITIVE_SIGNAL: 1,
  NPC_DEATH_NEGATIVE_SIGNAL: -1,
  DEATHS_MAX_SCORE: 3,
  DEATHS_MIN_SCORE: -3,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Checks whether the given NPC has a hitpoints varbit, thus giving all clients
 * a shared view of the NPC's hitpoints.
 *
 * @param npcId
 * @returns
 */
function hasVarbitBasedHitpoints(npcId: number): boolean {
  return (
    Npc.isMaiden(npcId) ||
    Npc.isBloat(npcId) ||
    Npc.isNylocasVasilias(npcId) ||
    Npc.isSotetseg(npcId) ||
    Npc.isXarpus(npcId) ||
    Npc.isVerzik(npcId)
  );
}

/**
 * Returns the exponential decay constants for scoring a given NPC's hitpoints.
 *
 * @param npcId The ID of the NPC.
 * @returns The weight and decay constant.
 */
function getHitpointsScoringConstants(npcId: number): [number, number] {
  if (hasVarbitBasedHitpoints(npcId)) {
    return [
      ScoringConstants.HITPOINTS_VARBIT_WEIGHT,
      ScoringConstants.HITPOINTS_VARBIT_K,
    ];
  }
  return [
    ScoringConstants.HITPOINTS_REGULAR_WEIGHT,
    ScoringConstants.HITPOINTS_REGULAR_K,
  ];
}

export class SimilarityScorer {
  /**
   * Scores the similarity of the two tick states, with a higher score
   * indicating a likelihood that the two tick states represent the same moment
   * in time.
   *
   * A score of `-Infinity` indicates that the two tick states are incompatible.
   *
   * @returns The similarity score.
   */
  public score(tickA: TickState, tickB: TickState): number {
    if (!this.checkForCompatibility(tickA, tickB)) {
      return -Infinity;
    }

    const hitpointsScore = this.scoreNpcHitpoints(tickA, tickB);
    const playerAttacksScore = this.scorePlayerAttacks(tickA, tickB);
    const npcAttacksScore = this.scoreNpcAttacks(tickA, tickB);
    const prayersScore = this.scorePrayers(tickA, tickB);
    const deathsScore = this.scoreDeaths(tickA, tickB);

    // TODO(frolv): stage-specific events.

    console.log(
      `raw scores for tick ${tickA.getTick()} -> ${tickB.getTick()}:`,
      {
        hitpoints: hitpointsScore,
        playerAttacks: playerAttacksScore,
        npcAttacks: npcAttacksScore,
        prayers: prayersScore,
        deaths: deathsScore,
      },
    );

    return (
      hitpointsScore * ScoringConstants.COMPONENT_HITPOINTS_WEIGHT +
      (playerAttacksScore + npcAttacksScore) *
        ScoringConstants.COMPONENT_ATTACKS_WEIGHT +
      prayersScore * ScoringConstants.COMPONENT_PRAYERS_WEIGHT +
      deathsScore * ScoringConstants.COMPONENT_DEATHS_WEIGHT
    );
  }

  private checkForCompatibility(tickA: TickState, tickB: TickState): boolean {
    return (
      this.checkPlayerCompatibility(tickA, tickB) &&
      this.checkNpcCompatibility(tickA, tickB)
    );
  }

  /**
   * Checks whether the players who appear in both tick states could correspond
   * to the same tick.
   *
   * Each player visible to both tick states must be in the same position, and
   * have the same visible gear equipped.
   *
   * @returns Whether the players are compatible.
   */
  private checkPlayerCompatibility(
    tickA: TickState,
    tickB: TickState,
  ): boolean {
    const tickAPlayers = tickA.getPlayerStates();
    const tickBPlayers = tickB.getPlayerStates();

    for (const player of tickAPlayers.keys()) {
      const stateA = tickAPlayers.get(player);
      const stateB = tickBPlayers.get(player);
      if (!stateA || !stateB) {
        continue;
      }

      // Note: `isDead` is deliberately ignored, it first occurs on the tick
      // that a player's HP reaches 0, which could be affected by lag.

      if (stateA.x !== stateB.x || stateA.y !== stateB.y) {
        return false;
      }

      for (const slot of VISIBLE_EQUIPMENT_SLOTS) {
        const equipmentA = stateA.equipment[slot];
        const equipmentB = stateB.equipment[slot];
        if (equipmentA?.id !== equipmentB?.id) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Checks whether the NPCs that appear in both tick states could correspond
   * to the same tick.
   *
   * Each NPC visible to both tick states must have the same NPC ID and be in
   * the same position.
   *
   * @returns Whether the NPCs are compatible.
   */
  private checkNpcCompatibility(tickA: TickState, tickB: TickState): boolean {
    const npcsA = tickA.getNpcs();
    const npcsB = tickB.getNpcs();

    for (const roomId of npcsA.keys()) {
      const stateA = npcsA.get(roomId);
      const stateB = npcsB.get(roomId);
      if (!stateA || !stateB) {
        continue;
      }

      if (stateA.id !== stateB.id) {
        return false;
      }

      if (stateA.x !== stateB.x || stateA.y !== stateB.y) {
        return false;
      }
    }

    return true;
  }

  private scoreNpcHitpoints(tickA: TickState, tickB: TickState): number {
    const npcsA = tickA.getNpcs();
    const npcsB = tickB.getNpcs();

    let score = 0;

    for (const [roomId, stateA] of npcsA) {
      const stateB = npcsB.get(roomId);
      if (!stateA || !stateB) {
        continue;
      }

      const [weight, k] = getHitpointsScoringConstants(stateA.id);
      const hpA = this.normalizeHitpoints(stateA);
      const hpB = this.normalizeHitpoints(stateB);
      const delta = Math.abs(hpA - hpB);
      if (delta > ScoringConstants.HITPOINTS_DELTA_THRESHOLD) {
        // Hitpoints are inherently fuzzy between clients, so we just ignore
        // large differences instead of penalizing them.
        // TODO(frolv): Maybe penalize varbit-based NPCs?
        continue;
      }

      const decay = Math.exp(-k * delta * delta);
      score += weight * decay;
    }

    return Math.min(score, ScoringConstants.HITPOINTS_MAX_SCORE);
  }

  private normalizeHitpoints(state: NpcState): number {
    const base = state.hitpoints.getBase();
    if (base <= 0) {
      return 0;
    }

    const current = Math.min(state.hitpoints.getCurrent(), base);
    return current / base;
  }

  private scorePlayerAttacks(tickA: TickState, tickB: TickState): number {
    const transformAttacks = (state: TickState): Attack[] => {
      return state
        .getPlayerStates()
        .values()
        .map((playerState) => {
          if (!playerState?.attack) {
            return null;
          }

          return {
            actor: playerState.username,
            target: playerState.attack.target?.toString() ?? null,
            uniqueId: `${playerState.attack.type}:${playerState.attack.weaponId}`,
          };
        })
        .filter((attack) => attack !== null)
        .toArray();
    };

    const attacksA = transformAttacks(tickA);
    const attacksB = transformAttacks(tickB);

    return this.scoreAttacks(
      tickA,
      tickB,
      attacksA,
      attacksB,
      (state, actor) => state.getPlayerState(actor) !== null,
      (state, target) => state.getNpcState(Number(target)) !== null,
      {
        positive: ScoringConstants.PLAYER_ATTACK_POSITIVE_SIGNAL,
        weakPositive: ScoringConstants.PLAYER_ATTACK_WEAK_POSITIVE_SIGNAL,
        weakNegative: ScoringConstants.PLAYER_ATTACK_WEAK_NEGATIVE_SIGNAL,
        contradictory: ScoringConstants.PLAYER_ATTACK_CONTRADICTORY_PENALTY,
        min: ScoringConstants.PLAYER_ATTACK_MIN_SCORE,
        max: ScoringConstants.PLAYER_ATTACK_MAX_SCORE,
      },
    );
  }

  private scoreNpcAttacks(tickA: TickState, tickB: TickState): number {
    const transformAttacks = (state: TickState): Attack[] => {
      return state
        .getNpcs()
        .entries()
        .map(([roomId, npcState]) => {
          if (!npcState?.attack) {
            return null;
          }

          return {
            actor: roomId.toString(),
            target: npcState.attack.target,
            uniqueId: npcState.attack.type.toString(),
          };
        })
        .filter((attack) => attack !== null)
        .toArray();
    };

    const attacksA = transformAttacks(tickA);
    const attacksB = transformAttacks(tickB);

    return this.scoreAttacks(
      tickA,
      tickB,
      attacksA,
      attacksB,
      (state, actor) => state.getNpcState(Number(actor)) !== null,
      (state, target) => state.getPlayerState(target) !== null,
      {
        positive: ScoringConstants.NPC_ATTACK_POSITIVE_SIGNAL,
        weakPositive: ScoringConstants.NPC_ATTACK_WEAK_POSITIVE_SIGNAL,
        weakNegative: ScoringConstants.NPC_ATTACK_WEAK_NEGATIVE_SIGNAL,
        contradictory: ScoringConstants.NPC_ATTACK_CONTRADICTORY_PENALTY,
        min: ScoringConstants.NPC_ATTACK_MIN_SCORE,
        max: ScoringConstants.NPC_ATTACK_MAX_SCORE,
      },
    );
  }

  private scoreAttacks(
    tickA: TickState,
    tickB: TickState,
    attacksA: Attack[],
    attacksB: Attack[],
    hasActor: (state: TickState, actor: string) => boolean,
    hasTarget: (state: TickState, target: string) => boolean,
    attackScores: AttackScores,
  ): number {
    if (attacksA.length === 0 && attacksB.length === 0) {
      return 0;
    }

    // Each actor can only perform one attack per tick, so we check whether the
    // same actor performed the same attack in both tick states.
    //
    // First, categorize attacks by actor by whether they are present in both
    // tick states, or only one, which will determine how the attack is scored.
    const inBoth: [Attack, Attack][] = [];
    const missingFromA: string[] = [];
    const missingFromB: string[] = [];

    for (const attackA of attacksA) {
      const attackB = attacksB.find((attack) => attack.actor === attackA.actor);
      if (!attackB) {
        missingFromB.push(attackA.actor);
      } else {
        inBoth.push([attackA, attackB]);
      }
    }

    for (const attackB of attacksB) {
      const attackA = attacksA.find((attack) => attack.actor === attackB.actor);
      if (!attackA) {
        missingFromA.push(attackB.actor);
      }
    }

    // For actors who attacked in both tick states, first strictly check if they
    // performed the same attack. If both have a target, it must also strictly
    // match.
    //
    // If neither has a target, add a weak positive signal for the attack type
    // matching.
    //
    // If one attack has a target but the other does not, check if the target is
    // visible in the other tick state. If it is not present, add a weak
    // positive signal for the attack matching. If it is present, apply a weak
    // penalty for omitting the target.
    //
    // For actors who attacked in only one of the tick states, check if that
    // actor is visible in the other. If they are not, ignore the event
    // altogether. Otherwise, apply a weak negative signal.
    //
    // We use weak negative signals for the latter cases instead of
    // contradictory penalties because clients do not know when attacks occur;
    // they infer attacks from actors' animations. This makes attack inherently
    // fuzzy: if a client drops the tick in which an actor attacks, they may
    // first see the animation on the next tick, in which case the attack would
    // only exist in one of the tick states. Everything else in that tick could
    // indicate a match, so we don't want to penalize these omissions or minor
    // inconsistencies. The weak negative penalty primarily exists for
    // tiebreaking.
    let score = 0;

    for (const [a, b] of inBoth) {
      if (a.uniqueId !== b.uniqueId) {
        score += attackScores.contradictory;
        continue;
      }

      if (a.target !== null && b.target !== null) {
        if (a.target === b.target) {
          score += attackScores.positive;
        } else {
          score += attackScores.contradictory;
        }
      } else if (a.target !== null) {
        if (hasTarget(tickB, a.target)) {
          score += attackScores.weakNegative;
        } else {
          score += attackScores.weakPositive;
        }
      } else if (b.target !== null) {
        if (hasTarget(tickA, b.target)) {
          score += attackScores.weakNegative;
        } else {
          score += attackScores.weakPositive;
        }
      } else {
        // If neither attack has a target, apply a weak positive signal.
        score += attackScores.weakPositive;
      }
    }

    for (const actor of missingFromB) {
      if (hasActor(tickB, actor)) {
        score += attackScores.weakNegative;
      }
    }

    for (const actor of missingFromA) {
      if (hasActor(tickA, actor)) {
        score += attackScores.weakNegative;
      }
    }

    return clamp(score, attackScores.min, attackScores.max);
  }

  private scorePrayers(tickA: TickState, tickB: TickState): number {
    let score = 0;

    const playersA = tickA.getPlayerStates();
    const playersB = tickB.getPlayerStates();

    for (const [player, stateA] of playersA) {
      const stateB = playersB.get(player);
      if (!stateA || !stateB) {
        continue;
      }

      const overheadsA = stateA.prayers.overheads();
      const overheadsB = stateB.prayers.overheads();
      if (overheadsA.isEmpty() && overheadsB.isEmpty()) {
        continue;
      }

      if (overheadsA.equals(overheadsB)) {
        score += ScoringConstants.PRAYERS_POSITIVE_SIGNAL;
      } else {
        score += ScoringConstants.PRAYERS_NEGATIVE_SIGNAL;
      }
    }

    return clamp(
      score,
      ScoringConstants.PRAYERS_MIN_SCORE,
      ScoringConstants.PRAYERS_MAX_SCORE,
    );
  }

  private scoreDeaths(tickA: TickState, tickB: TickState): number {
    let score = 0;

    const playersA = tickA.getPlayerStates();
    const playersB = tickB.getPlayerStates();

    for (const [player, stateA] of playersA) {
      const stateB = playersB.get(player);
      if (!stateA || !stateB) {
        continue;
      }

      const aDied = tickA
        .getEventsByType(Event.Type.PLAYER_DEATH)
        .find((event) => event.getPlayer()?.getName() === player);
      const bDied = tickB
        .getEventsByType(Event.Type.PLAYER_DEATH)
        .find((event) => event.getPlayer()?.getName() === player);
      if (aDied !== undefined && bDied !== undefined) {
        score += ScoringConstants.PLAYER_DEATH_POSITIVE_SIGNAL;
      }
    }

    const npcsA = tickA.getNpcs();
    const npcsB = tickB.getNpcs();
    for (const [roomId, stateA] of npcsA) {
      const stateB = npcsB.get(roomId);
      if (!stateA || !stateB) {
        continue;
      }

      const aDied = tickA
        .getEventsByType(Event.Type.NPC_DEATH)
        .find((event) => event.getNpc()?.getRoomId() === roomId);
      const bDied = tickB
        .getEventsByType(Event.Type.NPC_DEATH)
        .find((event) => event.getNpc()?.getRoomId() === roomId);
      if (aDied === undefined && bDied === undefined) {
        continue;
      }

      if (aDied !== undefined && bDied !== undefined) {
        score += ScoringConstants.NPC_DEATH_POSITIVE_SIGNAL;
      } else {
        score += ScoringConstants.NPC_DEATH_NEGATIVE_SIGNAL;
      }
    }

    return clamp(
      score,
      ScoringConstants.DEATHS_MIN_SCORE,
      ScoringConstants.DEATHS_MAX_SCORE,
    );
  }
}

type Attack = {
  actor: string;
  target: string | null;
  uniqueId: string;
};

type AttackScores = {
  positive: number;
  weakPositive: number;
  weakNegative: number;
  contradictory: number;
  min: number;
  max: number;
};
