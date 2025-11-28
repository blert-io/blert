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
const STAGE = Stage.TOB_MAIDEN as ProtoStage;

type PlayerStateOptions = {
  username: string;
  source?: DataSource;
  x?: number;
  y?: number;
  isDead?: boolean;
  equipment?: Partial<Record<EquipmentSlot, EquippedItem | null>>;
};

function createPlayerState({
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
    emptyEquipment[slot] = item;
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

function createPlayerUpdateEvent({
  tick,
  name,
  source = DataSource.SECONDARY,
  x = 0,
  y = 0,
  equipmentDeltas = [],
}: {
  tick: number;
  name: string;
  source?: DataSource;
  x?: number;
  y?: number;
  equipmentDeltas?: ItemDelta[];
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.PLAYER_UPDATE);
  event.setTick(tick);
  event.setStage(STAGE);
  event.setXCoord(x);
  event.setYCoord(y);

  const player = new ProtoEvent.Player();
  player.setName(name);
  player.setDataSource(source as ProtoDataSource);
  player.setEquipmentDeltasList(equipmentDeltas.map((delta) => delta.toRaw()));
  event.setPlayer(player);

  return event;
}

function createNpcSpawnEvent({
  tick,
  roomId,
  npcId,
  x,
  y,
  hitpoints,
}: {
  tick: number;
  roomId: number;
  npcId: number;
  x: number;
  y: number;
  hitpoints: number;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(ProtoEvent.Type.NPC_SPAWN);
  event.setTick(tick);
  event.setStage(STAGE);
  event.setXCoord(x);
  event.setYCoord(y);

  const npc = new ProtoEvent.Npc();
  npc.setRoomId(roomId);
  npc.setId(npcId);
  npc.setHitpoints(new SkillLevel(hitpoints, hitpoints).toRaw());
  event.setNpc(npc);

  return event;
}

describe('TickState', () => {
  it('returns false when merging ticks with different indices', () => {
    const tick0 = new TickState(0, [], { player1: null });
    const tick1 = new TickState(1, [], { player1: null });

    expect(tick0.merge(tick1)).toBe(false);
  });

  it('overrides player state with primary data when merging', () => {
    const basePlayer = createPlayerState({
      username: 'player1',
      source: DataSource.SECONDARY,
    });
    const targetPlayer = createPlayerState({
      username: 'player1',
      source: DataSource.PRIMARY,
      x: 5,
      y: 7,
    });

    const base = new TickState(
      0,
      [createPlayerUpdateEvent({ tick: 0, name: 'player1' })],
      { player1: basePlayer },
    );
    const target = new TickState(
      0,
      [
        createPlayerUpdateEvent({
          tick: 0,
          name: 'player1',
          source: DataSource.PRIMARY,
          x: 5,
          y: 7,
        }),
      ],
      { player1: targetPlayer },
    );

    expect(base.merge(target)).toBe(true);
    const mergedState = base.getPlayerState('player1');
    expect(mergedState).not.toBeNull();
    expect(mergedState).toMatchObject({
      source: DataSource.PRIMARY,
      x: 5,
      y: 7,
    });

    const mergedEvent = base
      .getEvents()
      .find((event) => event.getType() === ProtoEvent.Type.PLAYER_UPDATE)!;
    expect(mergedEvent.getPlayer()!.getDataSource()).toBe(DataSource.PRIMARY);
  });

  it('keeps base player data when merging secondary sources', () => {
    const basePlayer = createPlayerState({
      username: 'player1',
      source: DataSource.SECONDARY,
      x: 1,
      y: 2,
    });
    const targetPlayer = createPlayerState({
      username: 'player1',
      source: DataSource.SECONDARY,
      x: 9,
      y: 9,
    });

    const base = new TickState(
      0,
      [createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 1, y: 2 })],
      { player1: basePlayer },
    );
    const target = new TickState(
      0,
      [createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 9, y: 9 })],
      { player1: targetPlayer },
    );

    expect(base.merge(target)).toBe(true);
    const mergedState = base.getPlayerState('player1');
    expect(mergedState).toMatchObject({
      source: DataSource.SECONDARY,
      x: 1,
      y: 2,
    });
  });

  it('merges NPC state that was missing from the base tick', () => {
    const base = new TickState(0, [], { player1: null });
    const target = new TickState(
      0,
      [
        createNpcSpawnEvent({
          tick: 0,
          npcId: 100,
          roomId: 1,
          x: 10,
          y: 20,
          hitpoints: 500,
        }),
      ],
      { player1: null },
    );

    expect(base.merge(target)).toBe(true);
    const spawnEvent = base
      .getEvents()
      .find((event) => event.getType() === ProtoEvent.Type.NPC_SPAWN);
    expect(spawnEvent).toBeDefined();
    expect(spawnEvent!.getNpc()!.getRoomId()).toBe(1);
    expect(spawnEvent!.getNpc()!.getId()).toBe(100);
    expect(spawnEvent!.getXCoord()).toBe(10);
    expect(spawnEvent!.getYCoord()).toBe(20);
    expect(
      SkillLevel.fromRaw(spawnEvent!.getNpc()!.getHitpoints()).getCurrent(),
    ).toBe(500);
  });

  it('resynchronizes equipment deltas after a merge overrides a player', () => {
    const previousPlayer = createPlayerState({
      username: 'player1',
      source: DataSource.PRIMARY,
      equipment: {
        [EquipmentSlot.HEAD]: { id: 100, quantity: 1 },
      },
    });
    const previousTick = new TickState(
      0,
      [
        createPlayerUpdateEvent({
          tick: 0,
          name: 'player1',
          source: DataSource.PRIMARY,
          equipmentDeltas: [new ItemDelta(100, 1, EquipmentSlot.HEAD, true)],
        }),
      ],
      { player1: previousPlayer },
    );

    const base = new TickState(
      1,
      [createPlayerUpdateEvent({ tick: 1, name: 'player1' })],
      {
        player1: createPlayerState({
          username: 'player1',
          equipment: { [EquipmentSlot.HEAD]: { id: 100, quantity: 1 } },
        }),
      },
    );

    const target = new TickState(
      1,
      [
        createPlayerUpdateEvent({
          tick: 1,
          name: 'player1',
          source: DataSource.PRIMARY,
          equipmentDeltas: [new ItemDelta(200, 1, EquipmentSlot.HEAD, true)],
        }),
      ],
      {
        player1: createPlayerState({
          username: 'player1',
          source: DataSource.PRIMARY,
          equipment: {
            [EquipmentSlot.HEAD]: { id: 200, quantity: 1 },
          },
        }),
      },
    );

    expect(base.merge(target)).toBe(true);
    base.resynchronize([previousTick, base]);

    const mergedEvent = base
      .getEvents()
      .find((event) => event.getType() === ProtoEvent.Type.PLAYER_UPDATE)!;
    const equipmentDeltas = mergedEvent
      .getPlayer()!
      .getEquipmentDeltasList()
      .map((delta) => ItemDelta.fromRaw(delta));

    expect(equipmentDeltas).toHaveLength(1);
    expect(equipmentDeltas[0]).toMatchObject({
      itemId: 200,
      quantity: 1,
      slot: EquipmentSlot.HEAD,
    });
  });
});
