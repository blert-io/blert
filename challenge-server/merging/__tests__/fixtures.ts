import {
  DataSource,
  EquipmentSlot,
  ItemDelta,
  NpcAttack,
  PlayerAttack,
  PrayerBook,
  PrayerSet,
  Stage,
  SkillLevel,
} from '@blert/common';
import {
  NpcAttackMap,
  Event as ProtoEvent,
  StageMap,
} from '@blert/common/generated/event_pb';

import { SYNTHETIC_EVENT_SOURCE } from '../event';
import { TickState, PlayerState, EquippedItem } from '../tick-state';

type ProtoStage = StageMap[keyof StageMap];
type ProtoDataSource =
  ProtoEvent.Player.DataSourceMap[keyof ProtoEvent.Player.DataSourceMap];
type ProtoNpcAttack = NpcAttackMap[keyof NpcAttackMap];

export function createEvent(
  type: ProtoEvent.TypeMap[keyof ProtoEvent.TypeMap],
  tick: number,
): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(type);
  event.setTick(tick);
  return event;
}

export function createTickState(
  tick: number,
  players: PlayerState[],
  events: ProtoEvent[] = [],
  source: number = SYNTHETIC_EVENT_SOURCE,
): TickState {
  const playerStates = new Map<string, PlayerState | null>();
  for (const player of players) {
    playerStates.set(player.username, player);
  }

  const tagged = events.map((event) => ({ event, source }));
  return new TickState(tick, tagged, playerStates);
}

export type PlayerAttackState = {
  type: PlayerAttack;
  weaponId: number;
  target: number | null;
};

export type PlayerStateOptions = {
  username: string;
  source?: DataSource;
  x?: number;
  y?: number;
  isDead?: boolean;
  equipment?: Partial<Record<EquipmentSlot, EquippedItem | null>>;
  prayers?: PrayerSet;
  attack?: PlayerAttackState | null;
};

export function createPlayerState({
  username,
  source = DataSource.SECONDARY,
  x = 0,
  y = 0,
  isDead = false,
  equipment = {},
  prayers,
  attack = null,
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
    prayers: prayers ?? PrayerSet.empty(PrayerBook.NORMAL),
    attack,
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

export function createPlayerDeathEvent({
  tick,
  name,
  x = 0,
  y = 0,
  stage = Stage.TOB_MAIDEN,
}: {
  tick: number;
  name: string;
  x?: number;
  y?: number;
  stage?: Stage;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.PLAYER_DEATH);
  event.setTick(tick);
  event.setStage(stage as ProtoStage);
  event.setXCoord(x);
  event.setYCoord(y);

  const player = new ProtoEvent.Player();
  player.setName(name);
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

export function createNpcAttackEvent({
  tick,
  roomId,
  npcId,
  attackType,
  target,
  x = 0,
  y = 0,
  hitpointsCurrent = 100,
  hitpointsBase,
  stage = Stage.TOB_MAIDEN,
}: {
  tick: number;
  roomId: number;
  npcId: number;
  attackType: NpcAttack;
  target?: string;
  x?: number;
  y?: number;
  hitpointsCurrent?: number;
  hitpointsBase?: number;
  stage?: Stage;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.NPC_ATTACK);
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

  const npcAttack = new ProtoEvent.NpcAttacked();
  npcAttack.setAttack(attackType as ProtoNpcAttack);
  if (target !== undefined) {
    npcAttack.setTarget(target);
  }
  event.setNpcAttack(npcAttack);

  return event;
}

export function createNpcDeathEvent({
  tick,
  roomId,
  npcId,
  x = 0,
  y = 0,
  stage = Stage.TOB_MAIDEN,
}: {
  tick: number;
  roomId: number;
  npcId: number;
  x?: number;
  y?: number;
  stage?: Stage;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.NPC_DEATH);
  event.setTick(tick);
  event.setStage(stage as ProtoStage);
  event.setXCoord(x);
  event.setYCoord(y);

  const npc = new ProtoEvent.Npc();
  npc.setRoomId(roomId);
  npc.setId(npcId);
  event.setNpc(npc);

  return event;
}

export function createVerzikBounceEvent({
  tick,
  npcAttackTick,
  bouncedPlayer,
}: {
  tick: number;
  npcAttackTick: number;
  bouncedPlayer: string;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.TOB_VERZIK_BOUNCE);
  event.setTick(tick);
  event.setStage(Stage.TOB_VERZIK as ProtoStage);

  const bounce = new ProtoEvent.VerzikBounce();
  bounce.setNpcAttackTick(npcAttackTick);
  bounce.setBouncedPlayer(bouncedPlayer);
  event.setVerzikBounce(bounce);

  return event;
}

export function createVerzikAttackStyleEvent({
  tick,
  npcAttackTick,
  style,
}: {
  tick: number;
  npcAttackTick: number;
  style: number;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.TOB_VERZIK_ATTACK_STYLE);
  event.setTick(tick);

  const attackStyle = new ProtoEvent.AttackStyle();
  attackStyle.setNpcAttackTick(npcAttackTick);
  attackStyle.setStyle(
    style as ProtoEvent.AttackStyle.StyleMap[keyof ProtoEvent.AttackStyle.StyleMap],
  );
  event.setVerzikAttackStyle(attackStyle);

  return event;
}
