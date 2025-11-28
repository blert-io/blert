import {
  DataSource,
  EquipmentSlot,
  ItemDelta,
  Stage,
  SkillLevel,
} from '@blert/common';
import {
  Event as ProtoEvent,
  StageMap,
} from '@blert/common/generated/event_pb';

import { TickState, PlayerState, EquippedItem } from '../tick-state';

type ProtoStage = StageMap[keyof StageMap];
type ProtoDataSource =
  ProtoEvent.Player.DataSourceMap[keyof ProtoEvent.Player.DataSourceMap];

export type PlayerStateOptions = {
  username: string;
  source?: DataSource;
  x?: number;
  y?: number;
  isDead?: boolean;
  equipment?: Partial<Record<EquipmentSlot, EquippedItem | null>>;
};

export function createPlayerState({
  username,
  source = DataSource.SECONDARY,
  x = 0,
  y = 0,
  isDead = false,
  equipment = {},
}: PlayerStateOptions): PlayerState {
  const emptyEquipment: Record<EquipmentSlot, EquippedItem | null> = {
    [EquipmentSlot.HEAD]: null,
    [EquipmentSlot.CAPE]: null,
    [EquipmentSlot.AMULET]: null,
    [EquipmentSlot.AMMO]: null,
    [EquipmentSlot.WEAPON]: null,
    [EquipmentSlot.TORSO]: null,
    [EquipmentSlot.SHIELD]: null,
    [EquipmentSlot.LEGS]: null,
    [EquipmentSlot.GLOVES]: null,
    [EquipmentSlot.BOOTS]: null,
    [EquipmentSlot.RING]: null,
    [EquipmentSlot.QUIVER]: null,
  };

  for (const [slot, item] of Object.entries(equipment)) {
    emptyEquipment[slot as unknown as EquipmentSlot] = item ?? null;
  }

  return {
    username,
    source,
    x,
    y,
    isDead,
    equipment: emptyEquipment,
  };
}

export function createPlayerUpdateEvent({
  tick,
  name,
  source = DataSource.SECONDARY,
  x = 0,
  y = 0,
  equipmentDeltas = [],
  stage = Stage.TOB_MAIDEN,
}: {
  tick: number;
  name: string;
  source?: DataSource;
  x?: number;
  y?: number;
  equipmentDeltas?: ItemDelta[];
  stage?: Stage;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.PLAYER_UPDATE);
  event.setTick(tick);
  event.setStage(stage as ProtoStage);
  event.setXCoord(x);
  event.setYCoord(y);

  const player = new ProtoEvent.Player();
  player.setName(name);
  player.setDataSource(source as ProtoDataSource);
  player.setEquipmentDeltasList(equipmentDeltas.map((delta) => delta.toRaw()));
  event.setPlayer(player);

  return event;
}

export function createNpcSpawnEvent({
  tick,
  roomId,
  npcId,
  x,
  y,
  hitpointsCurrent,
  hitpointsBase,
  stage = Stage.TOB_MAIDEN,
}: {
  tick: number;
  roomId: number;
  npcId: number;
  x: number;
  y: number;
  hitpointsCurrent: number;
  hitpointsBase?: number;
  stage?: Stage;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.NPC_SPAWN);
  event.setTick(tick);
  event.setStage(stage as ProtoStage);
  event.setXCoord(x);
  event.setYCoord(y);

  const npc = new ProtoEvent.Npc();
  npc.setRoomId(roomId);
  npc.setId(npcId);
  const base = hitpointsBase ?? hitpointsCurrent;
  npc.setHitpoints(new SkillLevel(hitpointsCurrent, base).toRaw());
  event.setNpc(npc);

  return event;
}

export function createTickState(
  tick: number,
  players: PlayerState[],
  events: ProtoEvent[] = [],
): TickState {
  const playerStates = players.reduce<Record<string, PlayerState | null>>(
    (acc, player) => ({
      ...acc,
      [player.username]: player,
    }),
    {},
  );

  return new TickState(tick, events, playerStates);
}
