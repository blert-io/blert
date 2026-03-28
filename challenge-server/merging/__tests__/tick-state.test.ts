import {
  DataSource,
  EquipmentSlot,
  ItemDelta,
  SkillLevel,
} from '@blert/common';
import { Event as ProtoEvent } from '@blert/common/generated/event_pb';

import { SYNTHETIC_EVENT_SOURCE, TaggedEvent } from '../event';
import {
  createEvent,
  createNpcDeathEvent,
  createNpcSpawnEvent,
  createPlayerDeathEvent,
  createPlayerState,
  createPlayerUpdateEvent,
} from './fixtures';
import { TickState } from '../tick-state';

function tag(
  events: ProtoEvent[],
  source: number = SYNTHETIC_EVENT_SOURCE,
): TaggedEvent[] {
  return events.map((event) => ({ event, source }));
}

describe('TickState', () => {
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
      tag([createPlayerUpdateEvent({ tick: 0, name: 'player1' })], 1),
      new Map([['player1', basePlayer]]),
    );
    const target = new TickState(
      0,
      tag(
        [
          createPlayerUpdateEvent({
            tick: 0,
            name: 'player1',
            source: DataSource.PRIMARY,
            x: 5,
            y: 7,
          }),
        ],
        2,
      ),
      new Map([['player1', targetPlayer]]),
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
      tag(
        [createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 1, y: 2 })],
        1,
      ),
      new Map([['player1', basePlayer]]),
    );
    const target = new TickState(
      0,
      tag(
        [createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 9, y: 9 })],
        2,
      ),
      new Map([['player1', targetPlayer]]),
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
    const base = new TickState(0, [], new Map([['player1', null]]));
    const target = new TickState(
      0,
      tag(
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
        2,
      ),
      new Map([['player1', null]]),
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
      tag(
        [
          createPlayerUpdateEvent({
            tick: 0,
            name: 'player1',
            source: DataSource.PRIMARY,
            equipmentDeltas: [new ItemDelta(100, 1, EquipmentSlot.HEAD, true)],
          }),
        ],
        1,
      ),
      new Map([['player1', previousPlayer]]),
    );

    const base = new TickState(
      1,
      tag([createPlayerUpdateEvent({ tick: 1, name: 'player1' })], 1),
      new Map([
        [
          'player1',
          createPlayerState({
            username: 'player1',
            equipment: { [EquipmentSlot.HEAD]: { id: 100, quantity: 1 } },
          }),
        ],
      ]),
    );

    const target = new TickState(
      1,
      tag(
        [
          createPlayerUpdateEvent({
            tick: 1,
            name: 'player1',
            source: DataSource.PRIMARY,
            equipmentDeltas: [new ItemDelta(200, 1, EquipmentSlot.HEAD, true)],
          }),
        ],
        2,
      ),
      new Map([
        [
          'player1',
          createPlayerState({
            username: 'player1',
            source: DataSource.PRIMARY,
            equipment: {
              [EquipmentSlot.HEAD]: { id: 200, quantity: 1 },
            },
          }),
        ],
      ]),
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

  it('only merges tick-state events from other, ignoring stream events', () => {
    const baseNpc = createNpcSpawnEvent({
      tick: 0,
      npcId: 100,
      roomId: 1,
      x: 10,
      y: 20,
      hitpointsCurrent: 500,
    });

    const base = new TickState(
      0,
      tag([createPlayerUpdateEvent({ tick: 0, name: 'player1' }), baseNpc], 1),
      new Map([['player1', createPlayerState({ username: 'player1' })]]),
    );
    const target = new TickState(
      0,
      tag(
        [
          createPlayerUpdateEvent({ tick: 0, name: 'player2' }),
          createPlayerDeathEvent({ tick: 0, name: 'player1' }),
          createNpcDeathEvent({ tick: 0, roomId: 1, npcId: 100 }),
          createNpcSpawnEvent({
            tick: 0,
            npcId: 200,
            roomId: 2,
            x: 30,
            y: 40,
            hitpointsCurrent: 300,
          }),
          createEvent(ProtoEvent.Type.TOB_BLOAT_DOWN, 0),
          createEvent(ProtoEvent.Type.TOB_VERZIK_PHASE, 0),
          createEvent(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS, 0),
        ],
        2,
      ),
      new Map([
        ['player1', createPlayerState({ username: 'player1' })],
        ['player2', createPlayerState({ username: 'player2' })],
      ]),
    );

    expect(base.merge(target)).toBe(true);

    // The merged tick should contain exactly:
    // - PLAYER_UPDATE for player1 (from base)
    // - PLAYER_UPDATE for player2 (from targe)
    // - NPC_SPAWN for roomId 1 (from base)
    // - NPC_SPAWN for roomId 2 (from target)
    // - TOB_MAIDEN_BLOOD_SPLATS (graphics, from target)
    // Stream events (PLAYER_DEATH, NPC_DEATH, TOB_BLOAT_DOWN, TOB_VERZIK_PHASE)
    // should not be present.
    const types = base
      .getEvents()
      .map((e) => e.getType())
      .sort();
    expect(types).toEqual(
      [
        ProtoEvent.Type.PLAYER_UPDATE,
        ProtoEvent.Type.PLAYER_UPDATE,
        ProtoEvent.Type.NPC_SPAWN,
        ProtoEvent.Type.NPC_SPAWN,
        ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS,
      ].sort(),
    );
  });

  it('does not merge player death events when overriding with primary data', () => {
    const base = new TickState(
      0,
      tag([createPlayerUpdateEvent({ tick: 0, name: 'player1' })], 1),
      new Map([['player1', createPlayerState({ username: 'player1' })]]),
    );
    const target = new TickState(
      0,
      tag(
        [
          createPlayerUpdateEvent({
            tick: 0,
            name: 'player1',
            source: DataSource.PRIMARY,
          }),
          createPlayerDeathEvent({ tick: 0, name: 'player1' }),
        ],
        2,
      ),
      new Map([
        [
          'player1',
          createPlayerState({
            username: 'player1',
            source: DataSource.PRIMARY,
          }),
        ],
      ]),
    );

    expect(base.merge(target)).toBe(true);

    // Should contain exactly one PLAYER_UPDATE with PRIMARY data.
    const events = base.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].getType()).toBe(ProtoEvent.Type.PLAYER_UPDATE);
    expect(events[0].getPlayer()!.getDataSource()).toBe(DataSource.PRIMARY);
  });

  it('keeps graphics events from both sides without deduplication', () => {
    const base = new TickState(
      0,
      tag([createEvent(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS, 0)], 1),
      new Map([['player1', null]]),
    );
    const target = new TickState(
      0,
      tag([createEvent(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS, 0)], 2),
      new Map([['player1', null]]),
    );

    expect(base.merge(target)).toBe(true);

    const events = base.getEvents();
    expect(events).toHaveLength(2);
    expect(
      events.every(
        (e) => e.getType() === ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS,
      ),
    ).toBe(true);
  });

  describe('extractEvents', () => {
    it('removes and returns events of specified types', () => {
      const base = new TickState(
        0,
        tag(
          [
            createPlayerUpdateEvent({ tick: 0, name: 'player1' }),
            createPlayerDeathEvent({ tick: 0, name: 'player1' }),
            createEvent(ProtoEvent.Type.TOB_BLOAT_DOWN, 0),
            createEvent(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS, 0),
          ],
          1,
        ),
        new Map([['player1', createPlayerState({ username: 'player1' })]]),
      );

      const streamTypes = new Set([
        ProtoEvent.Type.PLAYER_DEATH,
        ProtoEvent.Type.TOB_BLOAT_DOWN,
      ] as const);

      const extracted = base.extractEvents(streamTypes);

      // Should return exactly the two stream events.
      expect(extracted.map((t) => t.event.getType()).sort()).toEqual(
        [ProtoEvent.Type.PLAYER_DEATH, ProtoEvent.Type.TOB_BLOAT_DOWN].sort(),
      );

      // Remaining events should be exactly the non-extracted ones.
      const remaining = base
        .getEvents()
        .map((e) => e.getType())
        .sort();
      expect(remaining).toEqual(
        [
          ProtoEvent.Type.PLAYER_UPDATE,
          ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS,
        ].sort(),
      );
    });
  });
});
