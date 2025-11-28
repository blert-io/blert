import {
  DataSource,
  EquipmentSlot,
  ItemDelta,
  SkillLevel,
} from '@blert/common';
import { Event as ProtoEvent } from '@blert/common/generated/event_pb';

import {
  createNpcSpawnEvent,
  createPlayerState,
  createPlayerUpdateEvent,
} from './fixtures';
import { TickState } from '../tick-state';

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
          hitpointsCurrent: 500,
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
