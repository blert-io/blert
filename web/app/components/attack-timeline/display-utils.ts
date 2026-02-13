import {
  BCFNpcActor,
  BCFNpcAttackAction,
  BCFResolver,
  NpcPhase,
} from '@blert/bcf';
import { Npc, NpcAttack } from '@blert/common';

import { bcfToNpcAttack } from './attack-metadata';
import { BackgroundColor, ChartColor } from './types';

const BLOAT_DOWN_TICKS = 32;

type PhaseMetadata = {
  name: string;
  repeatable: boolean;
};

/** Mapping of BCF encounter phase types to display names. */
const RELEVANT_PHASE_SPLIT_NAMES: Record<string, PhaseMetadata> = {
  TOB_MAIDEN_70S: { name: '70s', repeatable: false },
  TOB_MAIDEN_50S: { name: '50s', repeatable: false },
  TOB_MAIDEN_30S: { name: '30s', repeatable: false },
  TOB_NYLO_WAVE_1: { name: '1', repeatable: false },
  TOB_NYLO_WAVE_2: { name: '2', repeatable: false },
  TOB_NYLO_WAVE_3: { name: '3', repeatable: false },
  TOB_NYLO_WAVE_4: { name: '4', repeatable: false },
  TOB_NYLO_WAVE_5: { name: '5', repeatable: false },
  TOB_NYLO_WAVE_6: { name: '6', repeatable: false },
  TOB_NYLO_WAVE_7: { name: '7', repeatable: false },
  TOB_NYLO_WAVE_8: { name: '8', repeatable: false },
  TOB_NYLO_WAVE_9: { name: '9', repeatable: false },
  TOB_NYLO_WAVE_10: { name: '10', repeatable: false },
  TOB_NYLO_WAVE_11: { name: '11', repeatable: false },
  TOB_NYLO_WAVE_12: { name: '12', repeatable: false },
  TOB_NYLO_WAVE_13: { name: '13', repeatable: false },
  TOB_NYLO_WAVE_14: { name: '14', repeatable: false },
  TOB_NYLO_WAVE_15: { name: '15', repeatable: false },
  TOB_NYLO_WAVE_16: { name: '16', repeatable: false },
  TOB_NYLO_WAVE_17: { name: '17', repeatable: false },
  TOB_NYLO_WAVE_18: { name: '18', repeatable: false },
  TOB_NYLO_WAVE_19: { name: '19', repeatable: false },
  TOB_NYLO_WAVE_20: { name: '20', repeatable: false },
  TOB_NYLO_WAVE_21: { name: '21', repeatable: false },
  TOB_NYLO_WAVE_22: { name: '22', repeatable: false },
  TOB_NYLO_WAVE_23: { name: '23', repeatable: false },
  TOB_NYLO_WAVE_24: { name: '24', repeatable: false },
  TOB_NYLO_WAVE_25: { name: '25', repeatable: false },
  TOB_NYLO_WAVE_26: { name: '26', repeatable: false },
  TOB_NYLO_WAVE_27: { name: '27', repeatable: false },
  TOB_NYLO_WAVE_28: { name: '28', repeatable: false },
  TOB_NYLO_WAVE_29: { name: '29', repeatable: false },
  TOB_NYLO_WAVE_30: { name: '30', repeatable: false },
  TOB_NYLO_WAVE_31: { name: '31', repeatable: false },
  TOB_NYLO_CLEANUP: { name: 'Cleanup', repeatable: false },
  TOB_NYLO_BOSS_SPAWN: { name: 'Boss', repeatable: false },
  TOB_SOTETSEG_MAZE_1: { name: '66%', repeatable: false },
  TOB_SOTETSEG_MAZE_2: { name: '33%', repeatable: false },

  COLOSSEUM_REINFORCEMENTS: { name: 'Reinforcements', repeatable: false },

  INFERNO_ZUK_SET: { name: 'Set', repeatable: true },
  INFERNO_ZUK_JAD: { name: 'Jad', repeatable: false },
  INFERNO_ZUK_HEALERS: { name: 'Healers', repeatable: false },
};

/** Mapping of BCF NPC phase types to display names. */
const RELEVANT_NPC_PHASE_SPLIT_NAMES: Record<string, string> = {
  TOB_XARPUS_P2: 'Start',
  TOB_XARPUS_P3: 'Screech',

  // Verzik phase events occur immediately when the phase changes and include
  // the transition animation, but players usually think of the phase starting
  // once Verzik becomes attackable again.
  TOB_VERZIK_P2: 'P1 End',
  TOB_VERZIK_P3: 'P2 End',
};

/**
 * Provides derived display data for a BCF timeline.
 *
 * This class pre-computes display properties (background colors, NPC labels)
 * from semantic actions in the BCF document.
 */
export class TimelineDisplay {
  private readonly resolver: BCFResolver;
  private readonly backgroundColors: BackgroundColor[];
  private readonly npcLabels: Map<string, string>;
  private readonly splits: Map<number, string>;

  constructor(resolver: BCFResolver) {
    this.resolver = resolver;
    this.backgroundColors = [];
    this.npcLabels = new Map();
    this.splits = new Map();
    this.computeDisplayData();
  }

  /**
   * Returns the background color at the given tick.
   * @param tick The tick to get the background color for.
   * @returns Background color at the given tick, or `undefined` if not found.
   */
  getBackgroundColorAt(tick: number): BackgroundColor | undefined {
    return this.backgroundColors.find(
      (bg) => tick >= bg.startTick && tick <= bg.endTick,
    );
  }

  getNpcLabel(actorId: string, tick: number): string | undefined {
    return this.npcLabels.get(`${actorId}:${tick}`);
  }

  /**
   * Returns the name of the timeline split at the given tick.
   * @param tick The tick to get the timeline split name for.
   * @returns The timeline split name at the given tick, or `undefined` if no
   *   split occurs at the given tick.
   */
  getSplitNameAt(tick: number): string | undefined {
    return this.splits.get(tick);
  }

  private computeDisplayData(): void {
    this.processEncounterPhases();

    for (const actor of this.resolver.getActors()) {
      if (actor.type === 'npc') {
        this.processNpc(actor);
      }
    }

    for (const tick of this.resolver.ticks()) {
      for (const cell of tick.cells) {
        const actor = this.resolver.getActor(cell.actorId);
        if (actor?.type !== 'npc' || cell.actions === undefined) {
          continue;
        }

        for (const action of cell.actions) {
          if (action.type === 'npcAttack') {
            this.processNpcAttack(
              cell.actorId,
              action,
              tick.tick,
              action.attackType,
            );
          }
        }
      }
    }
  }

  private processEncounterPhases(): void {
    const phaseCounts = new Map<string, number>();

    for (const phase of this.resolver.getEncounterPhases()) {
      phaseCounts.set(
        phase.phaseType,
        (phaseCounts.get(phase.phaseType) ?? 0) + 1,
      );

      const relevantSplit = RELEVANT_PHASE_SPLIT_NAMES[phase.phaseType];
      if (relevantSplit !== undefined) {
        const name = relevantSplit.repeatable
          ? `${relevantSplit.name} ${phaseCounts.get(phase.phaseType)}`
          : relevantSplit.name;
        this.splits.set(phase.tick, name);
      }
    }
  }

  private processNpcAttack(
    actorId: string,
    action: BCFNpcAttackAction,
    tick: number,
    attackType: string,
  ): void {
    const attack = bcfToNpcAttack(attackType);

    switch (attack) {
      case NpcAttack.TOB_VERZIK_P1_AUTO:
        this.backgroundColors.push({
          startTick: tick,
          endTick: tick,
          color: 'red',
          intensity: 'medium',
        });
        break;

      case NpcAttack.TOB_VERZIK_P2_BOUNCE:
      case NpcAttack.TOB_VERZIK_P2_CABBAGE:
      case NpcAttack.TOB_VERZIK_P2_ZAP:
      case NpcAttack.TOB_VERZIK_P2_PURPLE:
      case NpcAttack.TOB_VERZIK_P2_MAGE:
        this.backgroundColors.push({
          startTick: tick - 1,
          endTick: tick - 1,
          color: 'red',
          intensity: 'medium',
        });
        break;

      case NpcAttack.INFERNO_MAGER_RESURRECT: {
        if (action.targetActorId) {
          const target = this.resolver.getActor(action.targetActorId);
          if (target) {
            this.npcLabels.set(
              `${actorId}:${tick}`,
              target.name.slice(0, 3).toUpperCase(),
            );
          }
        }
        break;
      }
    }
  }

  private processNpc(actor: BCFNpcActor): void {
    const phases = this.resolver.getNpcPhases(actor.id);
    if (phases.length > 0) {
      this.processNpcPhases(actor, phases);
    }

    if (Npc.isVerzikMatomenos(actor.npcId)) {
      if (actor.spawnTick !== undefined) {
        this.splits.set(actor.spawnTick, 'Reds');
        this.splits.set(actor.spawnTick + 10, 'Attackable');
      }
    }
  }

  private processNpcPhases(actor: BCFNpcActor, phases: NpcPhase[]): void {
    if (Npc.isBloat(actor.npcId)) {
      let lastUpTick = actor.spawnTick ?? 0;
      let downNumber = 1;

      for (const { tick, phaseType } of phases) {
        switch (phaseType) {
          case 'TOB_BLOAT_DOWN': {
            this.backgroundColors.push({
              startTick: lastUpTick,
              endTick: tick - 1,
              color: 'red',
              intensity: 'low',
            });

            this.splits.set(tick, `Down ${downNumber}`);
            downNumber++;

            for (let i = 0; i < BLOAT_DOWN_TICKS; i++) {
              const labelTick = tick + i;
              if (labelTick <= this.resolver.maxTick) {
                const countdown = BLOAT_DOWN_TICKS - i;
                this.npcLabels.set(
                  `${actor.id}:${labelTick}`,
                  String(countdown),
                );
              }
            }
            break;
          }

          case 'TOB_BLOAT_UP': {
            this.splits.set(tick, 'Moving');
            lastUpTick = tick;
            break;
          }
        }
      }

      if (
        phases.length > 0 &&
        phases[phases.length - 1].phaseType === 'TOB_BLOAT_UP'
      ) {
        this.backgroundColors.push({
          startTick: lastUpTick,
          endTick: actor.deathTick ?? this.resolver.maxTick,
          color: 'red',
          intensity: 'low',
        });
      }
      return;
    }

    if (
      Npc.isNylocasPrinkipas(actor.npcId) ||
      Npc.isNylocasVasilias(actor.npcId) ||
      Npc.isNylocasVasiliasDropping(actor.npcId)
    ) {
      for (let i = 0; i < phases.length; i++) {
        const { tick, phaseType } = phases[i];
        const phaseEnd =
          phases[i + 1]?.tick ?? actor.deathTick ?? this.resolver.maxTick;
        const backgroundColor = nyloBossBackgroundColor(phaseType);
        if (backgroundColor !== null) {
          this.backgroundColors.push({
            startTick: tick,
            endTick: phaseEnd - 1,
            color: backgroundColor,
            intensity: 'low',
          });
        }
      }
    }

    for (const { tick, phaseType } of phases) {
      const relevantSplit = RELEVANT_NPC_PHASE_SPLIT_NAMES[phaseType];
      if (relevantSplit !== undefined) {
        this.splits.set(tick, relevantSplit);
      }

      // Additionally show the ticks at which Verzik phases begin from a
      // player's perspective.
      switch (phaseType) {
        case 'TOB_VERZIK_P2':
          this.splits.set(tick + 13, 'P2');
          break;
        case 'TOB_VERZIK_P3':
          this.splits.set(tick + 6, 'P3');
          break;
      }
    }
  }
}

/** Returns the default row order for a timeline: NPCs, then players. */
export function defaultRowOrder(resolver: BCFResolver): string[] {
  const order: string[] = [];
  const actors = resolver.getActors();
  for (const actor of actors) {
    if (actor.type === 'npc') {
      order.push(actor.id);
    }
  }
  for (const actor of actors) {
    if (actor.type === 'player') {
      order.push(actor.id);
    }
  }
  return order;
}

function nyloBossBackgroundColor(phaseType: string): ChartColor | null {
  switch (phaseType) {
    case 'TOB_NYLO_BOSS_MELEE':
      return 'gray';
    case 'TOB_NYLO_BOSS_RANGED':
      return 'green';
    case 'TOB_NYLO_BOSS_MAGE':
      return 'cyan';
    default:
      return null;
  }
}
