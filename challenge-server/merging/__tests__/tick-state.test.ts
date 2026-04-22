import {
  DataSource,
  EquipmentSlot,
  ItemDelta,
  PlayerAttack,
  PlayerSpell,
  PrayerBook,
  PrayerSet,
  Prayer,
  SkillLevel,
  Stage,
} from '@blert/common';
import { Event as ProtoEvent } from '@blert/common/generated/event_pb';

import { SYNTHETIC_EVENT_SOURCE, TaggedEvent } from '../event';
import {
  createEvent,
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

const BASE_CLIENT_ID = 1;
const TARGET_CLIENT_ID = 2;

describe('TickState', () => {
  describe('merge', () => {
    it('overrides player state with primary data when merging', () => {
      const basePlayer = createPlayerState({
        username: 'player1',
        clientId: BASE_CLIENT_ID,
        source: DataSource.SECONDARY,
      });
      const targetPlayer = createPlayerState({
        username: 'player1',
        clientId: TARGET_CLIENT_ID,
        source: DataSource.PRIMARY,
        x: 5,
        y: 7,
      });

      const base = TickState.fromEvents(
        0,
        tag([createPlayerUpdateEvent({ tick: 0, name: 'player1' })], 1),
        new Map([['player1', basePlayer]]),
      );
      const target = TickState.fromEvents(
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

      expect(base.merge(target)).toEqual([]);
      const mergedState = base.getPlayerState('player1');
      expect(mergedState).not.toBeNull();
      expect(mergedState).toMatchObject({
        source: DataSource.PRIMARY,
        x: 5,
        y: 7,
      });
    });

    it('keeps base player data when merging secondary sources', () => {
      const basePlayer = createPlayerState({
        username: 'player1',
        clientId: BASE_CLIENT_ID,
        source: DataSource.SECONDARY,
        x: 1,
        y: 2,
      });
      const targetPlayer = createPlayerState({
        username: 'player1',
        clientId: TARGET_CLIENT_ID,
        source: DataSource.SECONDARY,
        x: 9,
        y: 9,
      });

      const base = TickState.fromEvents(
        0,
        tag(
          [createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 1, y: 2 })],
          1,
        ),
        new Map([['player1', basePlayer]]),
      );
      const target = TickState.fromEvents(
        0,
        tag(
          [createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 9, y: 9 })],
          2,
        ),
        new Map([['player1', targetPlayer]]),
      );

      expect(base.merge(target)).toEqual([]);
      const mergedState = base.getPlayerState('player1');
      expect(mergedState).toMatchObject({
        source: DataSource.SECONDARY,
        x: 1,
        y: 2,
      });
    });

    it('merges NPC state that was missing from the base tick', () => {
      const base = TickState.fromEvents(0, [], new Map([['player1', null]]));
      const target = TickState.fromEvents(
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

      expect(base.merge(target)).toEqual([]);
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

    it('unions graphics state from both sides', () => {
      const base = TickState.fromEvents(
        0,
        tag([createEvent(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS, 0)], 1),
        new Map([['player1', null]]),
      );
      const target = TickState.fromEvents(
        0,
        tag([createEvent(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS, 0)], 2),
        new Map([['player1', null]]),
      );

      expect(base.merge(target)).toEqual([]);

      const events = base.getEvents();
      expect(events).toHaveLength(2);
      expect(
        events.every(
          (e) => e.getType() === ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS,
        ),
      ).toBe(true);
    });
  });

  describe('resynchronize', () => {
    describe('player events', () => {
      it('synthesizes PLAYER_UPDATE with player position, identity, prayers, and dataSource', () => {
        const prayers = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
          Prayer.PIETY,
        ]);

        const tick = TickState.fromEvents(
          7,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                source: DataSource.PRIMARY,
                x: 12,
                y: 34,
                prayers,
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_VERZIK, null);

        const updates = tick.getEventsByType(ProtoEvent.Type.PLAYER_UPDATE);
        expect(updates).toHaveLength(1);
        const update = updates[0];
        expect(update).toBeDefined();
        expect(update.getTick()).toBe(7);
        expect(update.getStage()).toBe(Stage.TOB_VERZIK);
        expect(update.getXCoord()).toBe(12);
        expect(update.getYCoord()).toBe(34);

        const player = update.getPlayer()!;
        expect(player.getName()).toBe('player1');
        expect(player.getDataSource()).toBe(DataSource.PRIMARY);
        expect(player.getActivePrayers()).toBe(prayers.getRaw());
      });

      it('round-trips player stats through PLAYER_UPDATE', () => {
        const tick = TickState.fromEvents(
          3,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                stats: {
                  hitpoints: new SkillLevel(80, 99),
                  prayer: new SkillLevel(50, 70),
                  attack: new SkillLevel(99, 99),
                  strength: new SkillLevel(99, 99),
                  defence: new SkillLevel(75, 80),
                  ranged: new SkillLevel(99, 99),
                  magic: new SkillLevel(94, 96),
                },
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const update = tick
          .getEvents()
          .find((e) => e.getType() === ProtoEvent.Type.PLAYER_UPDATE)!;
        const player = update.getPlayer()!;
        expect(player.hasHitpoints()).toBe(true);
        expect(SkillLevel.fromRaw(player.getHitpoints())).toEqual(
          new SkillLevel(80, 99),
        );
        expect(SkillLevel.fromRaw(player.getPrayer())).toEqual(
          new SkillLevel(50, 70),
        );
        expect(SkillLevel.fromRaw(player.getAttack())).toEqual(
          new SkillLevel(99, 99),
        );
        expect(SkillLevel.fromRaw(player.getStrength())).toEqual(
          new SkillLevel(99, 99),
        );
        expect(SkillLevel.fromRaw(player.getDefence())).toEqual(
          new SkillLevel(75, 80),
        );
        expect(SkillLevel.fromRaw(player.getRanged())).toEqual(
          new SkillLevel(99, 99),
        );
        expect(SkillLevel.fromRaw(player.getMagic())).toEqual(
          new SkillLevel(94, 96),
        );
      });

      it('omits stat fields on PLAYER_UPDATE when state has no stats', () => {
        const tick = TickState.fromEvents(
          3,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const update = tick
          .getEvents()
          .find((e) => e.getType() === ProtoEvent.Type.PLAYER_UPDATE)!;
        const player = update.getPlayer()!;
        expect(player.hasHitpoints()).toBe(false);
        expect(player.hasPrayer()).toBe(false);
        expect(player.hasAttack()).toBe(false);
        expect(player.hasStrength()).toBe(false);
        expect(player.hasDefence()).toBe(false);
        expect(player.hasRanged()).toBe(false);
        expect(player.hasMagic()).toBe(false);
      });

      it('only emits the specific stat fields the client populated', () => {
        const tick = TickState.fromEvents(
          3,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                stats: {
                  hitpoints: new SkillLevel(80, 99),
                  prayer: null,
                  attack: null,
                  strength: null,
                  defence: null,
                  ranged: null,
                  magic: null,
                },
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const update = tick
          .getEvents()
          .find((e) => e.getType() === ProtoEvent.Type.PLAYER_UPDATE)!;
        const player = update.getPlayer()!;
        expect(player.hasHitpoints()).toBe(true);
        expect(player.hasPrayer()).toBe(false);
        expect(player.hasAttack()).toBe(false);
      });
    });

    it('resynchronizes equipment deltas', () => {
      const previousPlayer = createPlayerState({
        username: 'player1',
        clientId: BASE_CLIENT_ID,
        source: DataSource.PRIMARY,
        equipment: {
          [EquipmentSlot.HEAD]: { id: 100, quantity: 1 },
        },
      });
      const previousTick = TickState.fromEvents(
        0,
        tag(
          [
            createPlayerUpdateEvent({
              tick: 0,
              name: 'player1',
              source: DataSource.PRIMARY,
              equipmentDeltas: [
                new ItemDelta(100, 1, EquipmentSlot.HEAD, true),
              ],
            }),
          ],
          1,
        ),
        new Map([['player1', previousPlayer]]),
      );

      const base = TickState.fromEvents(
        1,
        tag([createPlayerUpdateEvent({ tick: 1, name: 'player1' })], 1),
        new Map([
          [
            'player1',
            createPlayerState({
              username: 'player1',
              clientId: BASE_CLIENT_ID,
              equipment: { [EquipmentSlot.HEAD]: { id: 100, quantity: 1 } },
            }),
          ],
        ]),
      );

      const target = TickState.fromEvents(
        1,
        tag(
          [
            createPlayerUpdateEvent({
              tick: 1,
              name: 'player1',
              source: DataSource.PRIMARY,
              equipmentDeltas: [
                new ItemDelta(200, 1, EquipmentSlot.HEAD, true),
              ],
            }),
          ],
          2,
        ),
        new Map([
          [
            'player1',
            createPlayerState({
              username: 'player1',
              clientId: TARGET_CLIENT_ID,
              source: DataSource.PRIMARY,
              equipment: {
                [EquipmentSlot.HEAD]: { id: 200, quantity: 1 },
              },
            }),
          ],
        ]),
      );

      expect(base.merge(target)).toEqual([]);
      base.resynchronize(Stage.TOB_MAIDEN, previousTick);

      const mergedEvents = base.getEventsByType(ProtoEvent.Type.PLAYER_UPDATE);
      const mergedEvent = mergedEvents[0];
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

    describe('offCooldownTick', () => {
      it('computes offCooldownTick from the attack cooldown', () => {
        const tick = TickState.fromEvents(
          5,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                attack: {
                  type: PlayerAttack.PUNCH, // cooldown 4
                  weaponId: 0,
                  target: null,
                },
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const updates = tick.getEventsByType(ProtoEvent.Type.PLAYER_UPDATE);
        expect(updates).toHaveLength(1);
        expect(updates[0].getPlayer()!.getOffCooldownTick()).toBe(5 + 4);
      });

      it('carries offCooldownTick forward when player does not attack', () => {
        const previous = TickState.fromEvents(
          3,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                offCooldownTick: 12,
              }),
            ],
          ]),
        );

        const tick = TickState.fromEvents(
          4,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, previous);

        const updates = tick.getEventsByType(ProtoEvent.Type.PLAYER_UPDATE);
        expect(updates).toHaveLength(1);
        expect(updates[0].getPlayer()!.getOffCooldownTick()).toBe(12);
      });

      it('defaults offCooldownTick to 0 when there is no previous tick and no attack', () => {
        const tick = TickState.fromEvents(
          0,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const updates = tick.getEventsByType(ProtoEvent.Type.PLAYER_UPDATE);
        expect(updates).toHaveLength(1);
        expect(updates[0].getPlayer()!.getOffCooldownTick()).toBe(0);
      });
    });

    describe('player attack events', () => {
      it('synthesizes PLAYER_ATTACK with type, weapon, distance, and target', () => {
        const tick = TickState.fromEvents(
          5,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                x: 10,
                y: 20,
                attack: {
                  type: PlayerAttack.TWISTED_BOW,
                  weaponId: 20997,
                  target: {
                    id: 8370,
                    roomId: 1,
                    sourceClientId: BASE_CLIENT_ID,
                  },
                  distanceToTarget: 3,
                },
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const attackEvents = tick.getEventsByType(
          ProtoEvent.Type.PLAYER_ATTACK,
        );
        expect(attackEvents).toHaveLength(1);
        const attackEvent = attackEvents[0];
        expect(attackEvent).toBeDefined();
        expect(attackEvent.getTick()).toBe(5);
        expect(attackEvent.getStage()).toBe(Stage.TOB_MAIDEN);
        expect(attackEvent.getXCoord()).toBe(10);
        expect(attackEvent.getYCoord()).toBe(20);
        expect(attackEvent.getPlayer()!.getName()).toBe('player1');

        const attack = attackEvent.getPlayerAttack()!;
        expect(attack.getType()).toBe(PlayerAttack.TWISTED_BOW);
        expect(attack.getDistanceToTarget()).toBe(3);
        expect(attack.getWeapon()!.getId()).toBe(20997);
        expect(attack.getWeapon()!.getSlot()).toBe(EquipmentSlot.WEAPON);
        expect(attack.getTarget()!.getId()).toBe(8370);
        expect(attack.getTarget()!.getRoomId()).toBe(1);
      });

      it('does not synthesize PLAYER_ATTACK when player has no attack', () => {
        const tick = TickState.fromEvents(
          5,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const attackEvents = tick.getEventsByType(
          ProtoEvent.Type.PLAYER_ATTACK,
        );
        expect(attackEvents).toHaveLength(0);
      });

      it('synthesizes PLAYER_ATTACK without target when attack target is null', () => {
        const tick = TickState.fromEvents(
          5,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                attack: {
                  type: PlayerAttack.PUNCH,
                  weaponId: 0,
                  target: null,
                },
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const attackEvents = tick.getEventsByType(
          ProtoEvent.Type.PLAYER_ATTACK,
        );
        expect(attackEvents).toHaveLength(1);
        const attackEvent = attackEvents[0];
        expect(attackEvent).toBeDefined();
        expect(attackEvent.getPlayerAttack()!.getTarget()).toBeUndefined();
      });
    });

    describe('player spell events', () => {
      it('synthesizes PLAYER_SPELL with an NPC target', () => {
        const tick = TickState.fromEvents(
          5,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                x: 10,
                y: 20,
                spell: {
                  type: PlayerSpell.LESSER_CORRUPTION,
                  target: { id: 8370, roomId: 1 },
                },
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const spellEvents = tick.getEventsByType(ProtoEvent.Type.PLAYER_SPELL);
        expect(spellEvents).toHaveLength(1);
        const spellEvent = spellEvents[0];
        expect(spellEvent).toBeDefined();
        expect(spellEvent.getTick()).toBe(5);
        expect(spellEvent.getStage()).toBe(Stage.TOB_MAIDEN);
        expect(spellEvent.getXCoord()).toBe(10);
        expect(spellEvent.getYCoord()).toBe(20);
        expect(spellEvent.getPlayer()!.getName()).toBe('player1');

        const spell = spellEvent.getPlayerSpell()!;
        expect(spell.getType()).toBe(PlayerSpell.LESSER_CORRUPTION);
        expect(spell.hasTargetNpc()).toBe(true);
        expect(spell.getTargetNpc()!.getId()).toBe(8370);
        expect(spell.getTargetNpc()!.getRoomId()).toBe(1);
        expect(spell.hasTargetPlayer()).toBe(false);
      });

      it('synthesizes PLAYER_SPELL with a player target', () => {
        const tick = TickState.fromEvents(
          5,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                spell: {
                  type: PlayerSpell.HEAL_OTHER,
                  target: 'player2',
                },
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const spellEvents = tick.getEventsByType(ProtoEvent.Type.PLAYER_SPELL);
        expect(spellEvents).toHaveLength(1);
        const spell = spellEvents[0].getPlayerSpell()!;
        expect(spell.getType()).toBe(PlayerSpell.HEAL_OTHER);
        expect(spell.hasTargetPlayer()).toBe(true);
        expect(spell.getTargetPlayer()).toBe('player2');
        expect(spell.hasTargetNpc()).toBe(false);
      });

      it('synthesizes PLAYER_SPELL without a target', () => {
        const tick = TickState.fromEvents(
          5,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                spell: {
                  type: PlayerSpell.SPELLBOOK_SWAP,
                },
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const spellEvents = tick.getEventsByType(ProtoEvent.Type.PLAYER_SPELL);
        expect(spellEvents).toHaveLength(1);
        const spell = spellEvents[0].getPlayerSpell()!;
        expect(spell.getType()).toBe(PlayerSpell.SPELLBOOK_SWAP);
        expect(spell.hasTargetPlayer()).toBe(false);
        expect(spell.hasTargetNpc()).toBe(false);
        expect(spell.hasNoTarget()).toBe(true);
      });

      it('does not synthesize PLAYER_SPELL when player has no spell', () => {
        const tick = TickState.fromEvents(
          5,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
              }),
            ],
          ]),
        );

        tick.resynchronize(Stage.TOB_MAIDEN, null);

        const spellEvents = tick.getEventsByType(ProtoEvent.Type.PLAYER_SPELL);
        expect(spellEvents).toHaveLength(0);
      });
    });
  });

  describe('extractEvents', () => {
    it('removes and returns events of specified types', () => {
      const base = TickState.fromEvents(
        0,
        tag(
          [
            createPlayerUpdateEvent({ tick: 0, name: 'player1' }),
            createPlayerDeathEvent({ tick: 0, name: 'player1' }),
            createEvent(ProtoEvent.Type.TOB_BLOAT_DOWN, 0),
            createEvent(ProtoEvent.Type.TOB_BLOAT_UP, 0),
          ],
          1,
        ),
        new Map([
          [
            'player1',
            createPlayerState({
              username: 'player1',
              clientId: BASE_CLIENT_ID,
            }),
          ],
        ]),
      );

      const typesToExtract = new Set([
        ProtoEvent.Type.PLAYER_DEATH,
        ProtoEvent.Type.TOB_BLOAT_DOWN,
      ] as const);

      const extracted = base.extractEvents(typesToExtract);

      expect(extracted.map((t) => t.event.getType()).sort()).toEqual(
        Array.from(typesToExtract.values()).sort(),
      );

      // Remaining events should be exactly the non-extracted ones.
      const remaining = base
        .getEvents()
        .map((e) => e.getType())
        .sort();
      expect(remaining).toEqual([ProtoEvent.Type.TOB_BLOAT_UP].sort());
    });
  });
});
