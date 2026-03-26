import {
  Challenge,
  Event,
  EventType,
  Npc,
  NpcAttack,
  NpcId,
  NpcSpawnEvent,
  NyloWaveSpawnEvent,
  PlayerAttack,
  PlayerSpell,
  SplitType,
  SpellTarget,
  Stage,
  XarpusPhase,
  VerzikPhase,
  getNpcDefinition,
} from '@blert/common';
import type {
  BCFAction,
  BCFActor,
  BCFCell,
  BCFNpcPhaseAction,
  BCFPhase,
  BCFPlayerState,
  BCFTick,
  BlertChartFormat,
} from '@blert/bcf';

import { simpleItemCache } from '../item-cache/simple';

import {
  EnhancedRoomNpc,
  EventTickMap,
  EventTypeMap,
  PlayerState,
  PlayerStateMap,
  RoomNpcMap,
} from './types';

export type ToBcfOptions = {
  /** Chart name. */
  name?: string;
  /** Chart description. */
  description?: string;
};

export type NpcActorId = `npc-${number}`;

export function toBcfNormalizedPlayerName(name: string): string {
  return name.toLowerCase().replace(/ /g, '_');
}

export function isNpcActorId(id: string): id is NpcActorId {
  return id.startsWith('npc-');
}

export function toNpcActorId(roomId: number): NpcActorId {
  return `npc-${roomId}`;
}

export function extractNpcRoomId(id: NpcActorId): number {
  return Number(id.substring(4));
}

/**
 * Converts player and NPC state maps to a BCF document.
 *
 * @param challenge The challenge metadata.
 * @param stage Stage whose timeline is being generated.
 * @param totalTicks Total number of ticks in the timeline.
 * @param eventsByTick Map of tick to events from `useStageEvents`.
 * @param eventsByType Map of event type to events from `useStageEvents`.
 * @param playerState Player state map from `useStageEvents`.
 * @param npcState NPC state map from `useStageEvents`.
 * @param options Optional BCF document configuration.
 * @returns A BCF document.
 */
export function toBcf(
  challenge: Challenge,
  stage: Stage,
  totalTicks: number,
  eventsByTick: EventTickMap,
  eventsByType: EventTypeMap,
  playerState: PlayerStateMap,
  npcState: RoomNpcMap,
  options: ToBcfOptions = {},
): BlertChartFormat {
  const { name, description } = options;

  const npcActorIds = new Map<number, NpcActorId>();

  const actors: BCFActor[] = [];

  const encounterPhases = buildBcfEncounterPhases(
    challenge,
    stage,
    eventsByType,
  );

  for (const playerName of playerState.keys()) {
    actors.push({
      type: 'player',
      id: toBcfNormalizedPlayerName(playerName),
      name: playerName,
    });
  }

  for (const [roomId, npc] of npcState) {
    const actorId = toNpcActorId(roomId);
    npcActorIds.set(roomId, actorId);

    // The death tick reported by the server is the tick at which the NPC fully
    // despawns following its death animation. However, for the purpose of
    // displaying charts, what we really care about is when the NPC's HP hits 0,
    // as that's when it effectively dies.
    let deathTick = npc.deathTick;
    while (
      deathTick > npc.spawnTick + 1 &&
      npc.stateByTick[deathTick - 1]?.hitpoints.getCurrent() === 0
    ) {
      deathTick--;
    }

    const npcDef = getNpcDefinition(npc.spawnNpcId);
    actors.push({
      type: 'npc',
      id: actorId,
      name: npcDef?.shortName ?? `NPC ${npc.spawnNpcId}`,
      npcId: npc.spawnNpcId,
      spawnTick: npc.spawnTick,
      deathTick,
    });
  }

  const ticks: BCFTick[] = [];
  for (let tick = 0; tick < totalTicks; tick++) {
    const tickData = buildTick(
      tick,
      playerState,
      npcState,
      eventsByTick[tick] ?? [],
      npcActorIds,
    );
    if (tickData !== null) {
      ticks.push(tickData);
    }
  }

  const rowOrder = [
    ...Array.from(npcState.entries())
      .filter(([_, npc]) => npc.relevant)
      .map(([roomId]) => toNpcActorId(roomId)),
    ...Array.from(playerState.keys()).map(toBcfNormalizedPlayerName),
  ];

  return {
    version: '1.0',
    name,
    description,
    config: { totalTicks, rowOrder, startTick: 1 },
    timeline: { actors, ticks, phases: encounterPhases },
  };
}

/**
 * Transforms a BCF document by applying a transform function to each action.
 */
export function transformBcf(
  bcf: BlertChartFormat,
  transformAction: (action: BCFAction) => BCFAction | null,
): BlertChartFormat {
  return {
    ...bcf,
    timeline: {
      ...bcf.timeline,
      ticks: bcf.timeline.ticks.map((tick) => ({
        ...tick,
        cells: tick.cells.map((cell) => ({
          ...cell,
          actions: transformCellActions(cell.actions, transformAction),
        })),
      })),
    },
  };
}

function transformCellActions(
  actions: BCFAction[] | undefined,
  transformAction: (action: BCFAction) => BCFAction | null,
): BCFAction[] | undefined {
  if (actions === undefined) {
    return undefined;
  }

  const newActions: BCFAction[] = [];
  for (const action of actions) {
    const transformed = transformAction(action);
    if (transformed !== null) {
      newActions.push(transformed);
    }
  }
  return newActions.length > 0 ? newActions : undefined;
}

function buildBcfEncounterPhases(
  challenge: Challenge,
  stage: Stage,
  eventsByType: EventTypeMap,
): BCFPhase[] {
  const encounterPhases: BCFPhase[] = [];

  if (stage >= Stage.COLOSSEUM_WAVE_1 && stage <= Stage.COLOSSEUM_WAVE_11) {
    const reinforcementTick = eventsByType[EventType.NPC_SPAWN]?.find((e) => {
      const npcId = (e as NpcSpawnEvent).npc.id;
      return (
        e.tick > 1 && (Npc.isJaguarWarrior(npcId) || Npc.isMinotaur(npcId))
      );
    });
    if (reinforcementTick !== undefined) {
      encounterPhases.push({
        tick: reinforcementTick.tick,
        phaseType: 'COLOSSEUM_REINFORCEMENTS',
      });
    }
    return encounterPhases;
  }

  if (stage === Stage.INFERNO_WAVE_69) {
    eventsByType[EventType.NPC_SPAWN]?.forEach((evt) => {
      const npcId = (evt as NpcSpawnEvent).npc.id;
      switch (npcId) {
        case NpcId.JAL_ZEK_ZUK as number:
          encounterPhases.push({
            tick: evt.tick,
            phaseType: 'INFERNO_ZUK_SET',
          });
          break;
        case NpcId.JALTOK_JAD_ZUK as number:
          encounterPhases.push({
            tick: evt.tick,
            phaseType: 'INFERNO_ZUK_JAD',
          });
          break;
        case NpcId.JAL_MEJJAK as number:
          encounterPhases.push({
            tick: evt.tick,
            phaseType: 'INFERNO_ZUK_HEALERS',
          });
          break;
      }
    });

    return encounterPhases;
  }

  const addSplitPhase = (split: SplitType, name?: string) => {
    const splitTick = challenge.splits[split];
    if (splitTick !== undefined) {
      encounterPhases.push({
        tick: splitTick,
        phaseType: name ?? SplitType[split],
      });
    }
  };

  switch (stage) {
    case Stage.TOB_MAIDEN:
      addSplitPhase(SplitType.TOB_MAIDEN_70S);
      addSplitPhase(SplitType.TOB_MAIDEN_50S);
      addSplitPhase(SplitType.TOB_MAIDEN_30S);
      break;

    case Stage.TOB_NYLOCAS:
      eventsByType[EventType.TOB_NYLO_WAVE_SPAWN]?.forEach((event) => {
        const wave = (event as NyloWaveSpawnEvent).nyloWave.wave;
        encounterPhases.push({
          tick: event.tick,
          phaseType: `TOB_NYLO_WAVE_${wave}`,
        });
      });
      addSplitPhase(SplitType.TOB_NYLO_CLEANUP);
      addSplitPhase(SplitType.TOB_NYLO_BOSS_SPAWN);
      break;

    case Stage.TOB_SOTETSEG:
      addSplitPhase(SplitType.TOB_SOTETSEG_66, 'TOB_SOTETSEG_MAZE_1');
      addSplitPhase(SplitType.TOB_SOTETSEG_33, 'TOB_SOTETSEG_MAZE_2');
      break;
  }

  return encounterPhases;
}

function buildTick(
  tick: number,
  playerState: PlayerStateMap,
  npcState: RoomNpcMap,
  events: Event[],
  npcActorIds: Map<number, NpcActorId>,
): BCFTick | null {
  const cells: BCFCell[] = [];

  for (const [playerName, states] of playerState) {
    const state = states[tick];
    if (state === null) {
      continue;
    }

    const cell = buildPlayerCell(
      toBcfNormalizedPlayerName(playerName),
      state,
      npcActorIds,
    );
    if (cell !== null) {
      cells.push(cell);
    }
  }

  for (const [roomId, npc] of npcState) {
    const cell = buildNpcCell(npcActorIds.get(roomId)!, tick, npc, events);
    if (cell !== null) {
      cells.push(cell);
    }
  }

  if (cells.length > 0) {
    return { tick, cells };
  }

  return null;
}

function buildPlayerCell(
  actorId: string,
  state: PlayerState,
  npcActorIds: Map<number, string>,
): BCFCell | null {
  const actions: BCFAction[] = [];

  if (state.attack) {
    const attackType = PlayerAttack[state.attack.type] ?? 'UNKNOWN';
    const targetActorId =
      state.attack.target?.roomId !== undefined
        ? npcActorIds.get(state.attack.target.roomId)
        : undefined;

    const weaponId = state.attack.weapon?.id;

    actions.push({
      type: 'attack',
      attackType,
      weaponId,
      weaponName:
        weaponId !== undefined
          ? simpleItemCache.getItemName(weaponId)
          : undefined,
      targetActorId,
      distanceToTarget: state.attack.distanceToTarget,
      damage: state.attack.damage,
    });
  }

  if (state.spell) {
    const spellType = PlayerSpell[state.spell.type] ?? 'UNKNOWN';
    let targetActorId: string | undefined;

    if (state.spell.target.type === SpellTarget.PLAYER) {
      targetActorId = toBcfNormalizedPlayerName(state.spell.target.player);
    } else if (state.spell.target.type === SpellTarget.NPC) {
      targetActorId = npcActorIds.get(state.spell.target.npc.roomId);
    }

    actions.push({
      type: 'spell',
      spellType,
      targetActorId,
    });
  }

  if (state.diedThisTick) {
    actions.push({ type: 'death' });
  }

  const cellState: BCFPlayerState = {};
  let hasState = false;

  if (state.isDead || state.diedThisTick) {
    cellState.isDead = true;
    hasState = true;
  }

  if (state.player.offCooldownTick <= state.tick) {
    cellState.offCooldown = true;
    hasState = true;
  }

  if (actions.length === 0 && !hasState) {
    return null;
  }

  return {
    actorId,
    actions: actions.length > 0 ? actions : undefined,
    state: hasState ? cellState : undefined,
  };
}

function buildNpcCell(
  actorId: string,
  tick: number,
  npc: EnhancedRoomNpc,
  events: Event[],
): BCFCell | null {
  const actions: BCFAction[] = [];

  const phaseEvent = getNpcPhaseAction(npc, tick, events);
  if (phaseEvent !== null) {
    actions.push(phaseEvent);
  }

  const state = npc.stateByTick[tick];
  if (state !== null) {
    if (state.attack) {
      const attackType = NpcAttack[state.attack.type] ?? 'UNKNOWN';
      let targetActorId =
        state.attack.target !== null
          ? toBcfNormalizedPlayerName(state.attack.target)
          : undefined;

      if (state.attack.type === NpcAttack.INFERNO_MAGER_RESURRECT) {
        const target = events.find(
          (event) =>
            event.type === EventType.NPC_SPAWN && !Npc.isBloblet(event.npc.id),
        );
        if (target !== undefined) {
          targetActorId = toNpcActorId((target as NpcSpawnEvent).npc.roomId);
        }
      }

      actions.push({
        type: 'npcAttack',
        attackType,
        targetActorId,
      });
    }
  }

  if (actions.length === 0) {
    return null;
  }
  return { actorId, actions: actions.length > 0 ? actions : undefined };
}

function getNpcPhaseAction(
  npc: EnhancedRoomNpc,
  tick: number,
  tickEvents: Event[],
): BCFNpcPhaseAction | null {
  const state = npc.stateByTick[tick];
  if (state === null) {
    return null;
  }

  if (Npc.isBloat(state.id)) {
    const downEvent = tickEvents.find(
      (e) => e.type === EventType.TOB_BLOAT_DOWN,
    );
    if (downEvent !== undefined) {
      return { type: 'npcPhase', phaseType: 'TOB_BLOAT_DOWN' };
    }
    const upEvent = tickEvents.find((e) => e.type === EventType.TOB_BLOAT_UP);
    if (upEvent !== undefined) {
      return { type: 'npcPhase', phaseType: 'TOB_BLOAT_UP' };
    }
  }

  if (Npc.isNylocasPrinkipas(state.id) || Npc.isNylocasVasilias(state.id)) {
    const lastState = npc.stateByTick[tick - 1];
    if (lastState?.id !== state.id) {
      const phaseType = getNyloBossPhaseType(state.id);
      if (phaseType !== null) {
        return { type: 'npcPhase', phaseType };
      }
    }
  }

  if (Npc.isXarpus(state.id)) {
    const event = tickEvents.find((e) => e.type === EventType.TOB_XARPUS_PHASE);
    if (event !== undefined) {
      switch (event.xarpusPhase) {
        case XarpusPhase.P1:
          return { type: 'npcPhase', phaseType: 'TOB_XARPUS_P1' };
        case XarpusPhase.P2:
          return { type: 'npcPhase', phaseType: 'TOB_XARPUS_P2' };
        case XarpusPhase.P3:
          return { type: 'npcPhase', phaseType: 'TOB_XARPUS_P3' };
      }
    }
  }

  if (Npc.isVerzik(state.id)) {
    const phase = tickEvents.find((e) => e.type === EventType.TOB_VERZIK_PHASE);
    if (phase !== undefined) {
      switch (phase.verzikPhase) {
        case VerzikPhase.P1:
          return { type: 'npcPhase', phaseType: 'TOB_VERZIK_P1' };
        case VerzikPhase.P2:
          return { type: 'npcPhase', phaseType: 'TOB_VERZIK_P2' };
        case VerzikPhase.P3:
          return { type: 'npcPhase', phaseType: 'TOB_VERZIK_P3' };
      }
    }
  }

  return null;
}

function getNyloBossPhaseType(npcId: NpcId): string | null {
  switch (npcId) {
    case NpcId.NYLOCAS_PRINKIPAS_DROPPING:
    case NpcId.NYLOCAS_PRINKIPAS_MELEE:
    case NpcId.NYLOCAS_VASILIAS_DROPPING_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_DROPPING_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_DROPPING_HARD:
    case NpcId.NYLOCAS_VASILIAS_MELEE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_MELEE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_MELEE_HARD:
      return 'TOB_NYLO_BOSS_MELEE';

    case NpcId.NYLOCAS_PRINKIPAS_RANGE:
    case NpcId.NYLOCAS_VASILIAS_RANGE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_RANGE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_RANGE_HARD:
      return 'TOB_NYLO_BOSS_RANGED';

    case NpcId.NYLOCAS_PRINKIPAS_MAGE:
    case NpcId.NYLOCAS_VASILIAS_MAGE_ENTRY:
    case NpcId.NYLOCAS_VASILIAS_MAGE_REGULAR:
    case NpcId.NYLOCAS_VASILIAS_MAGE_HARD:
      return 'TOB_NYLO_BOSS_MAGE';
  }

  return null;
}
