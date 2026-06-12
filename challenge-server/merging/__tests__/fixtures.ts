import {
  ChallengeMode,
  ChallengeType,
  DataSource,
  EquipmentSlot,
  ItemDelta,
  NpcAttack,
  PlayerAttack,
  PlayerSpell,
  PrayerBook,
  PrayerSet,
  Stage,
  SkillLevel,
} from '@blert/common';
import {
  Coords,
  NpcAttackMap,
  PlayerAttackMap,
  Event as ProtoEvent,
  StageMap,
} from '@blert/common/generated/event_pb';

import { ChallengeInfo, MergeContext, RegisteredClient } from '../context';
import { SYNTHETIC_EVENT_SOURCE } from '../event';
import { buildGraphicsForTick } from '../graphics';
import { MergeMapping } from '../tick-mapping';
import {
  buildNpcsForTick,
  EquippedItem,
  PlayerState,
  TickState,
  TickStateArray,
  WithProvenance,
} from '../tick-state';
import { CoordsLike } from '../world';

export type Proto<T> = T[keyof T];

type ProtoStage = Proto<StageMap>;
type ProtoDataSource = Proto<ProtoEvent.Player.DataSourceMap>;
type ProtoNpcAttack = Proto<NpcAttackMap>;

export const TEST_CHALLENGE: ChallengeInfo = {
  uuid: 'test',
  type: ChallengeType.TOB,
  mode: ChallengeMode.TOB_REGULAR,
  party: ['player1'],
};

/**
 * Builds a `MergeContext` with sensible defaults.
 * @param overrides Optional per-field overrides.
 */
export function createMergeContext(
  overrides: Partial<MergeContext> = {},
): MergeContext {
  return {
    challenge: overrides.challenge ?? TEST_CHALLENGE,
    stage: overrides.stage ?? Stage.TOB_MAIDEN,
    clients: overrides.clients ?? new Map<number, RegisteredClient>(),
    mapping: overrides.mapping ?? new MergeMapping(1),
    tracer: overrides.tracer,
    contestedTicks: overrides.contestedTicks ?? new Map<number, Set<number>>(),
  };
}

/**
 * Builds a `TickStateArray` of length `numTicks`, attaching the events from
 * `eventsByTick` to their corresponding ticks. Ticks not present in
 * `eventsByTick` are created with no events.
 *
 * `players` may be a constant list applied to every tick, or a function that
 * returns the per-tick player list.
 */
export function buildTickTimeline(
  numTicks: number,
  eventsByTick: Record<number, ProtoEvent[]> = {},
  players: PlayerState[] | ((tick: number) => PlayerState[]) = [],
): TickStateArray {
  const ticks: TickStateArray = [];
  for (let i = 0; i < numTicks; i++) {
    const tickPlayers = typeof players === 'function' ? players(i) : players;
    ticks.push(createTickState(i, tickPlayers, eventsByTick[i] ?? []));
  }
  return ticks;
}

export function createEvent(
  type: Proto<ProtoEvent.TypeMap>,
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
  return new TickState(
    tick,
    tagged,
    playerStates,
    buildNpcsForTick(tagged, null),
    buildGraphicsForTick(tagged, null),
  );
}

type PlayerAttackOptions = Partial<
  Omit<NonNullable<PlayerState['attack']>, 'target'>
> &
  Pick<NonNullable<PlayerState['attack']>, 'type' | 'weaponId'> & {
    target: NonNullable<PlayerState['attack']>['target'] | number;
  };

type PlayerSpellOptions = {
  type: PlayerSpell;
  target?: string | number | { id: number; roomId: number } | null;
};

export type PlayerStateOptions = {
  username: string;
  clientId: number;
  source?: DataSource;
  x?: number;
  y?: number;
  isDead?: boolean;
  equipment?: Partial<Record<EquipmentSlot, EquippedItem | null>>;
  prayers?: PrayerSet;
  attack?: PlayerAttackOptions | null;
  spell?: PlayerSpellOptions | null;
  stats?: NonNullable<PlayerState['stats']> | null;
  offCooldownTick?: number;
};

export function createPlayerState({
  username,
  clientId,
  source = DataSource.SECONDARY,
  x = 0,
  y = 0,
  isDead = false,
  equipment = {},
  prayers,
  attack = null,
  spell = null,
  stats = null,
  offCooldownTick,
}: PlayerStateOptions): WithProvenance<PlayerState> {
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

  const attackState: PlayerState['attack'] | null =
    attack !== null
      ? {
          sourceClientId: attack.sourceClientId ?? clientId,
          type: attack.type,
          weaponId: attack.weaponId,
          distanceToTarget: attack.distanceToTarget ?? 1,
          target:
            typeof attack.target === 'number'
              ? {
                  id: attack.target,
                  roomId: attack.target,
                  sourceClientId: clientId,
                }
              : (attack.target ?? null),
        }
      : null;

  let spellState: PlayerState['spell'] | null = null;
  if (spell !== null) {
    spellState = {
      sourceClientId: clientId,
      type: spell.type,
      target: null,
    };
    if (typeof spell.target === 'string') {
      spellState.target = {
        kind: 'player',
        name: spell.target,
        sourceClientId: clientId,
      };
    } else if (typeof spell.target === 'number') {
      spellState.target = {
        kind: 'npc',
        id: spell.target,
        roomId: spell.target,
        sourceClientId: clientId,
      };
    } else if (spell.target) {
      spellState.target = {
        kind: 'npc',
        id: spell.target.id,
        roomId: spell.target.roomId,
        sourceClientId: clientId,
      };
    }
  }

  return {
    sourceClientId: clientId,
    username,
    source,
    x,
    y,
    isDead,
    equipment: emptyEquipment,
    prayers: prayers ?? PrayerSet.empty(PrayerBook.NORMAL),
    attack: attackState,
    spell: spellState,
    stats,
    offCooldownTick: offCooldownTick ?? null,
  };
}

export function createPlayerUpdateEvent({
  tick,
  name,
  source = DataSource.SECONDARY,
  x = 0,
  y = 0,
  equipmentDeltas = [],
  snapshot = false,
  stage = Stage.TOB_MAIDEN,
}: {
  tick: number;
  name: string;
  source?: DataSource;
  x?: number;
  y?: number;
  equipmentDeltas?: ItemDelta[];
  snapshot?: boolean;
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
  player.setSnapshot(snapshot);
  event.setPlayer(player);

  return event;
}

export function createPlayerAttackEvent({
  tick,
  name,
  attackType,
  weaponId = 0,
  targetRoomId,
  x = 0,
  y = 0,
  stage = Stage.TOB_MAIDEN,
}: {
  tick: number;
  name: string;
  attackType: PlayerAttack;
  weaponId?: number;
  targetRoomId?: number;
  x?: number;
  y?: number;
  stage?: Stage;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.PLAYER_ATTACK);
  event.setTick(tick);
  event.setStage(stage as ProtoStage);
  event.setXCoord(x);
  event.setYCoord(y);

  const player = new ProtoEvent.Player();
  player.setName(name);
  event.setPlayer(player);

  const attack = new ProtoEvent.Attack();
  attack.setType(attackType as PlayerAttackMap[keyof PlayerAttackMap]);
  if (weaponId !== 0) {
    const weapon = new ProtoEvent.Player.EquippedItem();
    weapon.setSlot(
      EquipmentSlot.WEAPON as Proto<ProtoEvent.Player.EquipmentSlotMap>,
    );
    weapon.setId(weaponId);
    weapon.setQuantity(1);
    attack.setWeapon(weapon);
  }
  if (targetRoomId !== undefined) {
    const target = new ProtoEvent.Npc();
    target.setRoomId(targetRoomId);
    attack.setTarget(target);
  }
  event.setPlayerAttack(attack);

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

type NpcMaidenCrabFixture = {
  spawn: number;
  position: number;
  scuffed: boolean;
};

type NpcNyloFixture = {
  wave: number;
  parentRoomId: number;
  big: boolean;
  style: number;
  spawnType: number;
};

type NpcVerzikCrabFixture = {
  phase: number;
  spawn: number;
};

type NpcEventOptions = {
  tick: number;
  roomId: number;
  npcId: number;
  x: number;
  y: number;
  hitpointsCurrent: number;
  hitpointsBase?: number;
  prayers?: number;
  maidenCrab?: NpcMaidenCrabFixture;
  nylo?: NpcNyloFixture;
  verzikCrab?: NpcVerzikCrabFixture;
  stage?: Stage;
};

function createNpcEvent(
  type: Proto<ProtoEvent.TypeMap>,
  {
    tick,
    roomId,
    npcId,
    x,
    y,
    hitpointsCurrent,
    hitpointsBase,
    prayers,
    maidenCrab,
    nylo,
    verzikCrab,
    stage = Stage.TOB_MAIDEN,
  }: NpcEventOptions,
): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(type);
  event.setTick(tick);
  event.setStage(stage as ProtoStage);
  event.setXCoord(x);
  event.setYCoord(y);

  const npc = new ProtoEvent.Npc();
  npc.setRoomId(roomId);
  npc.setId(npcId);
  const base = hitpointsBase ?? hitpointsCurrent;
  npc.setHitpoints(new SkillLevel(hitpointsCurrent, base).toRaw());
  if (prayers !== undefined) {
    npc.setActivePrayers(prayers);
  }
  if (maidenCrab !== undefined) {
    const crab = new ProtoEvent.Npc.MaidenCrab();
    crab.setSpawn(
      maidenCrab.spawn as Proto<ProtoEvent.Npc.MaidenCrab.SpawnMap>,
    );
    crab.setPosition(
      maidenCrab.position as Proto<ProtoEvent.Npc.MaidenCrab.PositionMap>,
    );
    crab.setScuffed(maidenCrab.scuffed);
    npc.setMaidenCrab(crab);
  } else if (nylo !== undefined) {
    const n = new ProtoEvent.Npc.Nylo();
    n.setWave(nylo.wave);
    n.setParentRoomId(nylo.parentRoomId);
    n.setBig(nylo.big);
    n.setStyle(nylo.style as Proto<ProtoEvent.Npc.Nylo.StyleMap>);
    n.setSpawnType(nylo.spawnType as Proto<ProtoEvent.Npc.Nylo.SpawnTypeMap>);
    npc.setNylo(n);
  } else if (verzikCrab !== undefined) {
    const crab = new ProtoEvent.Npc.VerzikCrab();
    crab.setPhase(verzikCrab.phase as Proto<ProtoEvent.VerzikPhaseMap>);
    crab.setSpawn(
      verzikCrab.spawn as Proto<ProtoEvent.Npc.VerzikCrab.SpawnMap>,
    );
    npc.setVerzikCrab(crab);
  }
  event.setNpc(npc);

  return event;
}

export function createNpcSpawnEvent(options: NpcEventOptions): ProtoEvent {
  return createNpcEvent(ProtoEvent.Type.NPC_SPAWN, options);
}

export function createNpcUpdateEvent(options: NpcEventOptions): ProtoEvent {
  return createNpcEvent(ProtoEvent.Type.NPC_UPDATE, options);
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

function protoCoords({ x, y }: CoordsLike): Coords {
  const c = new Coords();
  c.setX(x);
  c.setY(y);
  return c;
}

export function createMaidenBloodSplatsEvent({
  tick,
  coords,
}: {
  tick: number;
  coords: CoordsLike[];
}): ProtoEvent {
  const event = createEvent(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS, tick);
  event.setStage(Stage.TOB_MAIDEN as ProtoStage);
  event.setMaidenBloodSplatsList(coords.map(protoCoords));
  return event;
}

export function createSoteMazePathEvent({
  tick,
  overworldTiles,
}: {
  tick: number;
  overworldTiles: CoordsLike[];
}): ProtoEvent {
  const event = createEvent(ProtoEvent.Type.TOB_SOTE_MAZE_PATH, tick);
  event.setStage(Stage.TOB_SOTETSEG as ProtoStage);
  const maze = new ProtoEvent.SoteMaze();
  maze.setOverworldTilesList(overworldTiles.map(protoCoords));
  event.setSoteMaze(maze);
  return event;
}

export function createVerzikYellowsEvent({
  tick,
  coords,
}: {
  tick: number;
  coords: CoordsLike[];
}): ProtoEvent {
  const event = createEvent(ProtoEvent.Type.TOB_VERZIK_YELLOWS, tick);
  event.setStage(Stage.TOB_VERZIK as ProtoStage);
  event.setVerzikYellowsList(coords.map(protoCoords));
  return event;
}

export function createVerzikBounceEvent({
  tick,
  npcAttackTick,
  bouncedPlayer,
}: {
  tick: number;
  npcAttackTick: number;
  bouncedPlayer?: string;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.TOB_VERZIK_BOUNCE);
  event.setTick(tick);
  event.setStage(Stage.TOB_VERZIK as ProtoStage);

  const bounce = new ProtoEvent.VerzikBounce();
  bounce.setNpcAttackTick(npcAttackTick);
  if (bouncedPlayer !== undefined) {
    bounce.setBouncedPlayer(bouncedPlayer);
  }
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
