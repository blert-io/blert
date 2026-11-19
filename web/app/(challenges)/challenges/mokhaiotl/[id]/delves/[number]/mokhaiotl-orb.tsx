import {
  AttackStyle,
  MokhaiotlOrbEvent,
  MokhaiotlOrbSource,
  NpcId,
} from '@blert/common';

import {
  CYCLES_PER_TICK,
  PlayerEntity,
  ProjectileEntity,
  projectilePlaysOnTick,
} from '@/components/map-renderer';
import { RoomNpcMap } from '@/utils/boss-room-state';

const ORB_MODELS: Record<AttackStyle, string> = {
  [AttackStyle.MELEE]: '/models/mokhaiotl-melee-orb.glb',
  [AttackStyle.RANGE]: '/models/mokhaiotl-ranged-orb.glb',
  [AttackStyle.MAGE]: '/models/mokhaiotl-magic-orb.glb',
};

const AUTO_ARC = {
  startHeight: 387,
  endHeight: 100,
  slope: 30,
  startDistance: 147,
};
const AUTO_LAUNCH_CYCLE = 55;
const AUTO_LANDING_CYCLE = -5;

const FLAT_ARC = {
  startHeight: 100,
  endHeight: 100,
  slope: 0,
  startDistance: 0,
};

export const ENTITY_MODELS = Object.values(ORB_MODELS);

export function orbsOnTick(
  npcs: RoomNpcMap,
  player: string,
  tick: number,
  events: MokhaiotlOrbEvent[],
): ProjectileEntity[] {
  return events.flatMap(({ mokhaiotlOrb: orb }) => {
    const burrowed = npcs
      .values()
      .some(
        (npc) =>
          npc.stateByTick[orb.startTick]?.id === NpcId.MOKHAIOTL_BURROWED,
      );
    const auto = orb.source === MokhaiotlOrbSource.MOKHAIOTL && !burrowed;
    const startCycle =
      orb.startTick * CYCLES_PER_TICK + (auto ? AUTO_LAUNCH_CYCLE : 0);
    const endCycle =
      orb.endTick * CYCLES_PER_TICK + (auto ? AUTO_LANDING_CYCLE : 0);
    if (!projectilePlaysOnTick(tick, startCycle, endCycle)) {
      return [];
    }

    return [
      new ProjectileEntity(
        { kind: 'tile', tile: orb.sourcePoint },
        { kind: 'entity', id: PlayerEntity.uniqueId(player) },
        { modelUrl: ORB_MODELS[orb.style], ...(auto ? AUTO_ARC : FLAT_ARC) },
        startCycle,
        endCycle,
        `orb-${orb.sourcePoint.x}-${orb.sourcePoint.y}-${orb.style}-${orb.startTick}`,
      ),
    ];
  });
}
