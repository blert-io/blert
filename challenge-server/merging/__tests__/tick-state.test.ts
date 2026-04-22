import {
  DataSource,
  EquipmentSlot,
  ItemDelta,
  MaidenCrabPosition,
  MaidenCrabSpawn,
  NpcAttack,
  NyloSpawn,
  NyloStyle,
  PlayerAttack,
  PlayerSpell,
  PrayerBook,
  PrayerSet,
  Prayer,
  RoomNpcType,
  SkillLevel,
  Stage,
  VerzikCrabSpawn,
  VerzikPhase,
} from '@blert/common';
import { Event as ProtoEvent } from '@blert/common/generated/event_pb';

import { SYNTHETIC_EVENT_SOURCE, TaggedEvent } from '../event';
import { coordKey, GraphicsState, GraphicsType } from '../graphics';
import {
  createEvent,
  createNpcAttackEvent,
  createNpcDeathEvent,
  createNpcSpawnEvent,
  createNpcUpdateEvent,
  createPlayerDeathEvent,
  createPlayerState,
  createPlayerUpdateEvent,
} from './fixtures';
import {
  buildNpcsForTick,
  buildNpcStates,
  NpcAttacked,
  NpcSubtype,
  PlayerState,
  ResyncContext,
  resynchronizeTicks,
  TickState,
  TickStateArray,
} from '../tick-state';

function tag(
  events: ProtoEvent[],
  source: number = SYNTHETIC_EVENT_SOURCE,
): TaggedEvent[] {
  return events.map((event) => ({ event, source }));
}

function resync(
  tick: TickState,
  stage: Stage,
  previous: TickState | null = null,
): void {
  const ctx: ResyncContext = {
    previousPlayers: new Map(),
    previousNpcs: new Map(),
    previousGraphics: null,
    deadPlayers: new Set(),
    deadNpcs: new Set(),
  };
  if (previous !== null) {
    const players = new Map<string, PlayerState>();
    for (const [name, state] of previous.getPlayerStates()) {
      if (state !== null) {
        players.set(name, state);
      }
    }
    ctx.previousPlayers = players;
    ctx.previousNpcs = previous.getNpcs();
    ctx.previousGraphics = previous.getGraphics();
  }
  tick.resynchronize(stage, ctx);
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

      const base = new TickState(
        0,
        tag([createPlayerUpdateEvent({ tick: 0, name: 'player1' })], 1),
        new Map([['player1', basePlayer]]),
        new Map(),
        new Map(),
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
        new Map(),
        new Map(),
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

      const base = new TickState(
        0,
        tag(
          [createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 1, y: 2 })],
          1,
        ),
        new Map([['player1', basePlayer]]),
        new Map(),
        new Map(),
      );
      const target = new TickState(
        0,
        tag(
          [createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 9, y: 9 })],
          2,
        ),
        new Map([['player1', targetPlayer]]),
        new Map(),
        new Map(),
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
      const base = new TickState(
        0,
        [],
        new Map([['player1', null]]),
        new Map(),
        new Map(),
      );
      const target = new TickState(
        0,
        [],
        new Map([['player1', null]]),
        new Map([
          [
            1,
            {
              id: 100,
              x: 10,
              y: 20,
              hitpoints: new SkillLevel(500, 500),
              prayers: PrayerSet.fromRaw(0),
              attack: null,
              subtype: null,
              sourceClientId: TARGET_CLIENT_ID,
            },
          ],
        ]),
        new Map(),
      );

      expect(base.merge(target)).toEqual([]);
      const npc = base.getNpcs().get(1)!;
      expect(npc.id).toBe(100);
      expect(npc.x).toBe(10);
      expect(npc.y).toBe(20);
      expect(npc.hitpoints.getCurrent()).toBe(500);
      expect(npc.sourceClientId).toBe(TARGET_CLIENT_ID);
    });

    it('keeps base NPC state when both sides see the same NPC', () => {
      const baseNpc = {
        id: 8360,
        x: 10,
        y: 20,
        hitpoints: new SkillLevel(500, 1000),
        prayers: PrayerSet.fromRaw(0b001),
        attack: {
          type: NpcAttack.TOB_MAIDEN_AUTO,
          target: 'player1',
          sourceClientId: BASE_CLIENT_ID,
        },
        subtype: null,
        sourceClientId: BASE_CLIENT_ID,
      };
      const targetNpc = {
        id: 8360,
        x: 10,
        y: 20,
        // Different HP (e.g. target missed a hitsplat); merge should keep base.
        hitpoints: new SkillLevel(480, 1000),
        prayers: PrayerSet.fromRaw(0b001),
        attack: null,
        subtype: null,
        sourceClientId: TARGET_CLIENT_ID,
      };

      const base = new TickState(
        0,
        [],
        new Map([['player1', null]]),
        new Map([[1, baseNpc]]),
        new Map(),
      );
      const target = new TickState(
        0,
        [],
        new Map([['player1', null]]),
        new Map([[1, targetNpc]]),
        new Map(),
      );

      expect(base.merge(target)).toEqual([]);

      const merged = base.getNpcs().get(1)!;
      expect(merged.hitpoints.getCurrent()).toBe(500);
      expect(merged.prayers.getRaw()).toBe(0b001);
      expect(merged.sourceClientId).toBe(BASE_CLIENT_ID);
      expect(merged.attack).not.toBeNull();
      expect(merged.attack!.type).toBe(NpcAttack.TOB_MAIDEN_AUTO);
      expect(merged.attack!.sourceClientId).toBe(BASE_CLIENT_ID);
    });

    it('unions graphics state from both sides', () => {
      const baseGraphics: GraphicsState = new Map([
        [
          GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
          new Map([[coordKey({ x: 1, y: 1 }), BASE_CLIENT_ID]]),
        ],
      ]);
      const targetGraphics: GraphicsState = new Map([
        [
          GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
          new Map([[coordKey({ x: 2, y: 2 }), TARGET_CLIENT_ID]]),
        ],
      ]);

      const base = new TickState(
        0,
        [],
        new Map([['player1', null]]),
        new Map(),
        baseGraphics,
      );
      const target = new TickState(
        0,
        [],
        new Map([['player1', null]]),
        new Map(),
        targetGraphics,
      );

      expect(base.merge(target)).toEqual([]);

      const splats = base
        .getGraphics()
        .get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)!;
      expect(splats.size).toBe(2);
      expect(splats.get(coordKey({ x: 1, y: 1 }))).toBe(BASE_CLIENT_ID);
      expect(splats.get(coordKey({ x: 2, y: 2 }))).toBe(TARGET_CLIENT_ID);
    });

    it('keeps the base observer when both sides see the same coord', () => {
      const shared = coordKey({ x: 5, y: 5 });
      const baseGraphics: GraphicsState = new Map([
        [
          GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
          new Map([[shared, BASE_CLIENT_ID]]),
        ],
      ]);
      const targetGraphics: GraphicsState = new Map([
        [
          GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
          new Map([[shared, TARGET_CLIENT_ID]]),
        ],
      ]);

      const base = new TickState(0, [], new Map(), new Map(), baseGraphics);
      const target = new TickState(0, [], new Map(), new Map(), targetGraphics);

      base.merge(target);

      const splats = base
        .getGraphics()
        .get(GraphicsType.TOB_MAIDEN_BLOOD_SPLATS)!;
      expect(splats.size).toBe(1);
      expect(splats.get(shared)).toBe(BASE_CLIENT_ID);
    });

    it('adds graphics types from target that base has not seen', () => {
      const baseGraphics: GraphicsState = new Map();
      const targetGraphics: GraphicsState = new Map([
        [
          GraphicsType.TOB_VERZIK_YELLOWS,
          new Map([[coordKey({ x: 9, y: 9 }), TARGET_CLIENT_ID]]),
        ],
      ]);

      const base = new TickState(0, [], new Map(), new Map(), baseGraphics);
      const target = new TickState(0, [], new Map(), new Map(), targetGraphics);

      base.merge(target);

      const yellows = base.getGraphics().get(GraphicsType.TOB_VERZIK_YELLOWS)!;
      expect(yellows).toBeDefined();
      expect(yellows.size).toBe(1);
      expect(yellows.get(coordKey({ x: 9, y: 9 }))).toBe(TARGET_CLIENT_ID);
    });
  });

  describe('resynchronize', () => {
    describe('player events', () => {
      it('synthesizes PLAYER_UPDATE with player position, identity, prayers, and dataSource', () => {
        const prayers = PrayerSet.fromPrayers(PrayerBook.NORMAL, [
          Prayer.PIETY,
        ]);

        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_VERZIK, null);

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
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

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
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

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
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

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
      const previousTick = new TickState(
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
        new Map(),
        new Map(),
      );

      const base = new TickState(
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
        new Map(),
        new Map(),
      );

      const target = new TickState(
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
        new Map(),
        new Map(),
      );

      expect(base.merge(target)).toEqual([]);
      resync(base, Stage.TOB_MAIDEN, previousTick);

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

    it('uses last known player state across gap ticks for equipment deltas', () => {
      // Player wears a HEAD item on tick 0, is absent on tick 1, and
      // re-appears on tick 2 wearing the same HEAD item. Tick 2 should
      // emit no equipment deltas.
      const tick0 = new TickState(
        0,
        [],
        new Map([
          [
            'player1',
            createPlayerState({
              username: 'player1',
              clientId: BASE_CLIENT_ID,
              source: DataSource.PRIMARY,
              equipment: {
                [EquipmentSlot.HEAD]: { id: 100, quantity: 1 },
              },
            }),
          ],
        ]),
        new Map(),
        new Map(),
      );
      const tick1 = new TickState(
        1,
        [],
        new Map([['player1', null]]),
        new Map(),
        new Map(),
      );
      const tick2 = new TickState(
        2,
        [],
        new Map([
          [
            'player1',
            createPlayerState({
              username: 'player1',
              clientId: BASE_CLIENT_ID,
              source: DataSource.PRIMARY,
              equipment: {
                [EquipmentSlot.HEAD]: { id: 100, quantity: 1 },
              },
            }),
          ],
        ]),
        new Map(),
        new Map(),
      );

      const ticks: TickStateArray = [tick0, tick1, tick2];
      resynchronizeTicks(Stage.TOB_MAIDEN, ticks);

      const tick2Update = tick2.getEventsByType(
        ProtoEvent.Type.PLAYER_UPDATE,
      )[0];
      const tick2Deltas = tick2Update
        .getPlayer()!
        .getEquipmentDeltasList()
        .map((delta) => ItemDelta.fromRaw(delta));
      expect(tick2Deltas).toHaveLength(0);
    });

    it('emits the death-tick state event then suppresses subsequent updates', () => {
      const tick0 = new TickState(
        0,
        [],
        new Map([
          [
            'player1',
            createPlayerState({
              username: 'player1',
              clientId: BASE_CLIENT_ID,
              source: DataSource.PRIMARY,
            }),
          ],
        ]),
        new Map(),
        new Map(),
      );
      const tick1 = new TickState(
        1,
        tag([createPlayerDeathEvent({ tick: 1, name: 'player1' })], 1),
        new Map([
          [
            'player1',
            createPlayerState({
              username: 'player1',
              clientId: BASE_CLIENT_ID,
              source: DataSource.PRIMARY,
              isDead: true,
            }),
          ],
        ]),
        new Map(),
        new Map(),
      );
      const tick2 = new TickState(
        2,
        [],
        new Map([
          [
            'player1',
            createPlayerState({
              username: 'player1',
              clientId: BASE_CLIENT_ID,
              source: DataSource.PRIMARY,
            }),
          ],
        ]),
        new Map(),
        new Map(),
      );

      const ticks: TickStateArray = [tick0, tick1, tick2];
      resynchronizeTicks(Stage.TOB_MAIDEN, ticks);

      // Death tick emits PLAYER_UPDATE and PLAYER_DEATH, but subsequent
      // ticks don't.
      expect(tick1.getEventsByType(ProtoEvent.Type.PLAYER_UPDATE).length).toBe(
        1,
      );
      expect(tick1.getEventsByType(ProtoEvent.Type.PLAYER_DEATH).length).toBe(
        1,
      );

      expect(tick2.getEventsByType(ProtoEvent.Type.PLAYER_UPDATE).length).toBe(
        0,
      );
    });

    it('suppresses NPC events after the NPC has died', () => {
      const npc = () => ({
        id: 8360,
        x: 10,
        y: 20,
        hitpoints: new SkillLevel(0, 1000),
        prayers: PrayerSet.fromRaw(0),
        attack: null,
        subtype: null,
        sourceClientId: BASE_CLIENT_ID,
      });

      const tick0 = new TickState(
        0,
        tag([createNpcDeathEvent({ tick: 0, roomId: 1, npcId: 8360 })], 1),
        new Map(),
        new Map([[1, npc()]]),
        new Map(),
      );
      const tick1 = new TickState(
        1,
        [],
        new Map(),
        new Map([[1, npc()]]),
        new Map(),
      );

      const ticks: TickStateArray = [tick0, tick1];
      resynchronizeTicks(Stage.TOB_MAIDEN, ticks);

      // Death tick emits NPC_UPDATE alongside NPC_DEATH, but subsequent
      // ticks don't.
      expect(tick0.getEventsByType(ProtoEvent.Type.NPC_UPDATE).length).toBe(1);
      expect(tick1.getEventsByType(ProtoEvent.Type.NPC_UPDATE).length).toBe(0);
    });

    describe('offCooldownTick', () => {
      it('computes offCooldownTick from the attack cooldown', () => {
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

        const updates = tick.getEventsByType(ProtoEvent.Type.PLAYER_UPDATE);
        expect(updates).toHaveLength(1);
        expect(updates[0].getPlayer()!.getOffCooldownTick()).toBe(5 + 4);
      });

      it('carries offCooldownTick forward when player does not attack', () => {
        const previous = new TickState(
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
          new Map(),
          new Map(),
        );

        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, previous);

        const updates = tick.getEventsByType(ProtoEvent.Type.PLAYER_UPDATE);
        expect(updates).toHaveLength(1);
        expect(updates[0].getPlayer()!.getOffCooldownTick()).toBe(12);
      });

      it('defaults offCooldownTick to 0 when there is no previous tick and no attack', () => {
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

        const updates = tick.getEventsByType(ProtoEvent.Type.PLAYER_UPDATE);
        expect(updates).toHaveLength(1);
        expect(updates[0].getPlayer()!.getOffCooldownTick()).toBe(0);
      });

      it('carries offCooldownTick across gap ticks', () => {
        const tick0 = new TickState(
          0,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                source: DataSource.PRIMARY,
                attack: {
                  type: PlayerAttack.SCYTHE,
                  weaponId: 22325,
                  target: 1,
                  sourceClientId: BASE_CLIENT_ID,
                },
              }),
            ],
          ]),
          new Map(),
          new Map(),
        );
        const tick1 = new TickState(
          1,
          [],
          new Map([['player1', null]]),
          new Map(),
          new Map(),
        );
        const tick2 = new TickState(
          2,
          [],
          new Map([
            [
              'player1',
              createPlayerState({
                username: 'player1',
                clientId: BASE_CLIENT_ID,
                source: DataSource.PRIMARY,
              }),
            ],
          ]),
          new Map(),
          new Map(),
        );

        const ticks: TickStateArray = [tick0, tick1, tick2];
        resynchronizeTicks(Stage.TOB_MAIDEN, ticks);

        const tick0Update = tick0.getEventsByType(
          ProtoEvent.Type.PLAYER_UPDATE,
        )[0];
        const tick0OffCooldown = tick0Update.getPlayer()!.getOffCooldownTick();
        const tick2Update = tick2.getEventsByType(
          ProtoEvent.Type.PLAYER_UPDATE,
        )[0];
        const tick2OffCooldown = tick2Update.getPlayer()!.getOffCooldownTick();

        expect(tick0OffCooldown).toBeGreaterThan(0);
        expect(tick2OffCooldown).toBe(tick0OffCooldown);
      });
    });

    describe('player attack events', () => {
      it('synthesizes PLAYER_ATTACK with type, weapon, distance, and target', () => {
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

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
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

        const attackEvents = tick.getEventsByType(
          ProtoEvent.Type.PLAYER_ATTACK,
        );
        expect(attackEvents).toHaveLength(0);
      });

      it('synthesizes PLAYER_ATTACK without target when attack target is null', () => {
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

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
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

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
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

        const spellEvents = tick.getEventsByType(ProtoEvent.Type.PLAYER_SPELL);
        expect(spellEvents).toHaveLength(1);
        const spell = spellEvents[0].getPlayerSpell()!;
        expect(spell.getType()).toBe(PlayerSpell.HEAL_OTHER);
        expect(spell.hasTargetPlayer()).toBe(true);
        expect(spell.getTargetPlayer()).toBe('player2');
        expect(spell.hasTargetNpc()).toBe(false);
      });

      it('synthesizes PLAYER_SPELL without a target', () => {
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

        const spellEvents = tick.getEventsByType(ProtoEvent.Type.PLAYER_SPELL);
        expect(spellEvents).toHaveLength(1);
        const spell = spellEvents[0].getPlayerSpell()!;
        expect(spell.getType()).toBe(PlayerSpell.SPELLBOOK_SWAP);
        expect(spell.hasTargetPlayer()).toBe(false);
        expect(spell.hasTargetNpc()).toBe(false);
        expect(spell.hasNoTarget()).toBe(true);
      });

      it('does not synthesize PLAYER_SPELL when player has no spell', () => {
        const tick = new TickState(
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
          new Map(),
          new Map(),
        );

        resync(tick, Stage.TOB_MAIDEN, null);

        const spellEvents = tick.getEventsByType(ProtoEvent.Type.PLAYER_SPELL);
        expect(spellEvents).toHaveLength(0);
      });
    });

    describe('npc events', () => {
      function npcsWith(state: {
        roomId?: number;
        id?: number;
        x?: number;
        y?: number;
        hitpoints?: SkillLevel;
        prayers?: PrayerSet;
        attack?: NpcAttacked | null;
        subtype?: NpcSubtype | null;
      }): Map<number, ReturnType<typeof npcStateOf>> {
        const roomId = state.roomId ?? 1;
        return new Map([[roomId, npcStateOf({ ...state, roomId })]]);
      }

      function npcStateOf(state: {
        roomId: number;
        id?: number;
        x?: number;
        y?: number;
        hitpoints?: SkillLevel;
        prayers?: PrayerSet;
        attack?: NpcAttacked | null;
        subtype?: NpcSubtype | null;
      }) {
        return {
          id: state.id ?? 8360,
          x: state.x ?? 50,
          y: state.y ?? 50,
          hitpoints: state.hitpoints ?? new SkillLevel(500, 1000),
          prayers: state.prayers ?? PrayerSet.fromRaw(0),
          attack:
            state.attack !== undefined
              ? state.attack === null
                ? null
                : { ...state.attack, sourceClientId: BASE_CLIENT_ID }
              : null,
          subtype: state.subtype ?? null,
          sourceClientId: BASE_CLIENT_ID,
        };
      }

      function maidenCrabSubtype(scuffed: boolean = false) {
        return {
          type: RoomNpcType.MAIDEN_CRAB,
          maidenCrab: {
            spawn: MaidenCrabSpawn.SEVENTIES,
            position: MaidenCrabPosition.S1,
            scuffed,
          },
        } as const;
      }

      it('synthesizes NPC_UPDATE with id, position, hitpoints, and prayers', () => {
        const tick = new TickState(
          5,
          [],
          new Map(),
          npcsWith({
            id: 8360,
            x: 25,
            y: 30,
            hitpoints: new SkillLevel(450, 1000),
            prayers: PrayerSet.fromRaw(0b011),
          }),
          new Map(),
        );
        resync(tick, Stage.TOB_MAIDEN, null);

        const updates = tick.getEventsByType(ProtoEvent.Type.NPC_UPDATE);
        expect(updates).toHaveLength(1);
        const npc = updates[0].getNpc()!;
        expect(npc.getId()).toBe(8360);
        expect(npc.getRoomId()).toBe(1);
        expect(updates[0].getXCoord()).toBe(25);
        expect(updates[0].getYCoord()).toBe(30);
        expect(SkillLevel.fromRaw(npc.getHitpoints()).getCurrent()).toBe(450);
        expect(npc.getActivePrayers()).toBe(0b011);
      });

      it('does not synthesize NPC_UPDATE on a tick where NPC_SPAWN exists for that roomId', () => {
        const spawn = createNpcSpawnEvent({
          tick: 0,
          roomId: 1,
          npcId: 8360,
          x: 50,
          y: 50,
          hitpointsCurrent: 500,
        });
        const tick = new TickState(
          0,
          tag([spawn], BASE_CLIENT_ID),
          new Map(),
          npcsWith({}),
          new Map(),
        );
        resync(tick, Stage.TOB_MAIDEN, null);

        const updates = tick.getEventsByType(ProtoEvent.Type.NPC_UPDATE);
        expect(updates).toHaveLength(0);
        const spawns = tick.getEventsByType(ProtoEvent.Type.NPC_SPAWN);
        expect(spawns).toHaveLength(1);
      });

      it('synthesizes NPC_ATTACK when state has an attack', () => {
        const tick = new TickState(
          5,
          [],
          new Map(),
          npcsWith({
            attack: { type: NpcAttack.TOB_MAIDEN_AUTO, target: 'player1' },
          }),
          new Map(),
        );
        resync(tick, Stage.TOB_MAIDEN, null);

        const attacks = tick.getEventsByType(ProtoEvent.Type.NPC_ATTACK);
        expect(attacks).toHaveLength(1);
        const a = attacks[0];
        expect(a.getNpcAttack()!.getAttack()).toBe(NpcAttack.TOB_MAIDEN_AUTO);
        expect(a.getNpcAttack()!.getTarget()).toBe('player1');
        expect(a.getNpc()!.getRoomId()).toBe(1);
      });

      it('does not synthesize NPC_ATTACK when state.attack is null', () => {
        const tick = new TickState(
          5,
          [],
          new Map(),
          npcsWith({ attack: null }),
          new Map(),
        );
        resync(tick, Stage.TOB_MAIDEN, null);
        expect(tick.getEventsByType(ProtoEvent.Type.NPC_ATTACK)).toHaveLength(
          0,
        );
      });

      it('emits sub-type fields on NPC_UPDATE when subtype differs from prev', () => {
        // Previous tick has no subtype; current tick has fresh maiden crab.
        // The first observation should emit the sub-type fields.
        const previous = new TickState(0, [], new Map(), new Map(), new Map());
        const tick = new TickState(
          1,
          [],
          new Map(),
          npcsWith({ id: 8366, subtype: maidenCrabSubtype(false) }),
          new Map(),
        );
        resync(tick, Stage.TOB_MAIDEN, previous);

        const update = tick.getEventsByType(ProtoEvent.Type.NPC_UPDATE)[0];
        expect(update).toBeDefined();
        const npc = update.getNpc()!;
        expect(npc.hasMaidenCrab()).toBe(true);
        expect(npc.getMaidenCrab()!.getSpawn()).toBe(MaidenCrabSpawn.SEVENTIES);
      });

      it('omits sub-type fields when subtype matches prev (carry-forward)', () => {
        const previous = new TickState(
          0,
          [],
          new Map(),
          npcsWith({ subtype: maidenCrabSubtype(false) }),
          new Map(),
        );
        const tick = new TickState(
          1,
          [],
          new Map(),
          npcsWith({ subtype: maidenCrabSubtype(false) }),
          new Map(),
        );
        resync(tick, Stage.TOB_MAIDEN, previous);

        const update = tick.getEventsByType(ProtoEvent.Type.NPC_UPDATE)[0];
        expect(update.getNpc()!.hasMaidenCrab()).toBe(false);
      });

      it('emits sub-type when fields change', () => {
        const previous = new TickState(
          0,
          [],
          new Map(),
          npcsWith({
            id: 8342,
            x: 11,
            y: 11,
            hitpoints: new SkillLevel(8, 8),
            prayers: PrayerSet.empty(PrayerBook.NORMAL),
            subtype: {
              type: RoomNpcType.NYLO,
              nylo: {
                wave: 21,
                parentRoomId: 9,
                big: false,
                style: NyloStyle.MELEE,
                spawnType: NyloSpawn.SOUTH,
              },
            },
          }),
          new Map(),
        );
        const tick = new TickState(
          1,
          [],
          new Map(),
          npcsWith({
            id: 8342,
            x: 11,
            y: 10,
            hitpoints: new SkillLevel(8, 8),
            prayers: PrayerSet.empty(PrayerBook.NORMAL),
            subtype: {
              type: RoomNpcType.NYLO,
              nylo: {
                wave: 21,
                parentRoomId: 9,
                big: false,
                style: NyloStyle.MAGE,
                spawnType: NyloSpawn.SOUTH,
              },
            },
          }),
          new Map(),
        );
        resync(tick, Stage.TOB_NYLOCAS, previous);

        const update = tick.getEventsByType(ProtoEvent.Type.NPC_UPDATE)[0];
        const nylo = update.getNpc()!.getNylo()!;
        expect(nylo.getStyle()).toBe(NyloStyle.MAGE);
      });
    });

    describe('graphics events', () => {
      it('synthesizes a snapshot graphics event from the merged state', () => {
        const graphics: GraphicsState = new Map([
          [
            GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
            new Map([
              [coordKey({ x: 1, y: 2 }), BASE_CLIENT_ID],
              [coordKey({ x: 3, y: 4 }), TARGET_CLIENT_ID],
            ]),
          ],
        ]);
        const tick = new TickState(0, [], new Map(), new Map(), graphics);
        resync(tick, Stage.TOB_MAIDEN, null);

        const events = tick.getEventsByType(
          ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS,
        );
        expect(events.length).toBe(1);
        const coords = events[0]
          .getMaidenBloodSplatsList()
          .map((c) => ({ x: c.getX(), y: c.getY() }));
        expect(coords).toEqual(
          expect.arrayContaining([
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ]),
        );
      });

      it('does not synthesize an event when the type is absent from state', () => {
        const tick = new TickState(0, [], new Map(), new Map(), new Map());
        resync(tick, Stage.TOB_MAIDEN, null);

        expect(
          tick.getEventsByType(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS).length,
        ).toBe(0);
      });

      it('drops raw graphics events from the input on resynchronize', () => {
        const graphics: GraphicsState = new Map([
          [
            GraphicsType.TOB_MAIDEN_BLOOD_SPLATS,
            new Map([[coordKey({ x: 5, y: 5 }), BASE_CLIENT_ID]]),
          ],
        ]);
        const tick = new TickState(
          0,
          tag([createEvent(ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS, 0)], 1),
          new Map(),
          new Map(),
          graphics,
        );
        resync(tick, Stage.TOB_MAIDEN, null);

        const events = tick.getEventsByType(
          ProtoEvent.Type.TOB_MAIDEN_BLOOD_SPLATS,
        );
        expect(events.length).toBe(1);
        expect(events[0].getMaidenBloodSplatsList().length).toBe(1);
      });
    });
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
        new Map(),
        new Map(),
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

  describe('clone', () => {
    it('deep-copies NPC subtype so mutations do not leak to the source', () => {
      const events = tag(
        [
          createNpcSpawnEvent({
            tick: 0,
            roomId: 5,
            npcId: 8360,
            x: 10,
            y: 20,
            hitpointsCurrent: 500,
            maidenCrab: {
              spawn: MaidenCrabSpawn.SEVENTIES,
              position: MaidenCrabPosition.S1,
              scuffed: false,
            },
          }),
        ],
        BASE_CLIENT_ID,
      );
      const original = new TickState(
        0,
        events,
        new Map(),
        buildNpcsForTick(events, null),
        new Map(),
      );
      const cloned = original.clone();

      const clonedSubtype = cloned.getNpcs().get(5)!.subtype!;
      expect(clonedSubtype.type).toBe(RoomNpcType.MAIDEN_CRAB);
      if (clonedSubtype.type === RoomNpcType.MAIDEN_CRAB) {
        clonedSubtype.maidenCrab.scuffed = true;
      }

      const originalSubtype = original.getNpcs().get(5)!.subtype!;
      expect(originalSubtype.type).toBe(RoomNpcType.MAIDEN_CRAB);
      if (originalSubtype.type === RoomNpcType.MAIDEN_CRAB) {
        expect(originalSubtype.maidenCrab.scuffed).toBe(false);
      }
    });
  });
});

describe('buildNpcsForTick', () => {
  it('captures id, position, hitpoints, prayers, and source from NPC_SPAWN', () => {
    const events = tag(
      [
        createNpcSpawnEvent({
          tick: 0,
          roomId: 5,
          npcId: 8360,
          x: 10,
          y: 20,
          hitpointsCurrent: 500,
          hitpointsBase: 1000,
          prayers: 0b101,
        }),
      ],
      7,
    );

    const npcs = buildNpcsForTick(events, null);

    expect(npcs.size).toBe(1);
    const state = npcs.get(5)!;
    expect(state.id).toBe(8360);
    expect(state.x).toBe(10);
    expect(state.y).toBe(20);
    expect(state.hitpoints).toEqual(new SkillLevel(500, 1000));
    expect(state.prayers.getRaw()).toBe(0b101);
    expect(state.sourceClientId).toBe(7);
    expect(state.attack).toBeNull();
    expect(state.subtype).toBeNull();
  });

  it('captures NPC_ATTACK and ties it to the existing NPC entry', () => {
    const events = tag(
      [
        createNpcSpawnEvent({
          tick: 0,
          roomId: 5,
          npcId: 8360,
          x: 10,
          y: 20,
          hitpointsCurrent: 500,
        }),
        createNpcAttackEvent({
          tick: 0,
          roomId: 5,
          npcId: 8360,
          attackType: NpcAttack.TOB_MAIDEN_AUTO,
          target: 'player1',
        }),
      ],
      7,
    );

    const npcs = buildNpcsForTick(events, null);

    const state = npcs.get(5)!;
    expect(state.attack).not.toBeNull();
    expect(state.attack!.type).toBe(NpcAttack.TOB_MAIDEN_AUTO);
    expect(state.attack!.target).toBe('player1');
    expect(state.attack!.sourceClientId).toBe(7);
  });

  it('captures the maidenCrab subtype', () => {
    const events = tag(
      [
        createNpcSpawnEvent({
          tick: 0,
          roomId: 5,
          npcId: 8366,
          x: 10,
          y: 20,
          hitpointsCurrent: 75,
          maidenCrab: {
            spawn: MaidenCrabSpawn.SEVENTIES,
            position: MaidenCrabPosition.S1,
            scuffed: true,
          },
        }),
      ],
      7,
    );

    const subtype = buildNpcsForTick(events, null).get(5)!.subtype!;
    expect(subtype.type).toBe(RoomNpcType.MAIDEN_CRAB);
    if (subtype.type === RoomNpcType.MAIDEN_CRAB) {
      expect(subtype.maidenCrab).toEqual({
        spawn: MaidenCrabSpawn.SEVENTIES,
        position: MaidenCrabPosition.S1,
        scuffed: true,
      });
    }
  });

  it('captures the nylo subtype', () => {
    const nylo = {
      wave: 17,
      parentRoomId: 9,
      big: false,
      style: NyloStyle.MELEE,
      spawnType: NyloSpawn.SPLIT,
    };
    const events = tag(
      [
        createNpcSpawnEvent({
          tick: 0,
          roomId: 5,
          npcId: 8342,
          x: 10,
          y: 20,
          hitpointsCurrent: 8,
          nylo,
        }),
      ],
      7,
    );

    const subtype = buildNpcsForTick(events, null).get(5)!.subtype!;
    expect(subtype.type).toBe(RoomNpcType.NYLO);
    if (subtype.type === RoomNpcType.NYLO) {
      expect(subtype.nylo).toEqual(nylo);
    }
  });

  it('captures the verzikCrab subtype', () => {
    const events = tag(
      [
        createNpcSpawnEvent({
          tick: 0,
          roomId: 5,
          npcId: 8382,
          x: 10,
          y: 20,
          hitpointsCurrent: 11,
          verzikCrab: {
            phase: VerzikPhase.P3,
            spawn: VerzikCrabSpawn.NORTH,
          },
        }),
      ],
      7,
    );

    const subtype = buildNpcsForTick(events, null).get(5)!.subtype!;
    expect(subtype.type).toBe(RoomNpcType.VERZIK_CRAB);
    if (subtype.type === RoomNpcType.VERZIK_CRAB) {
      expect(subtype.verzikCrab).toEqual({
        phase: VerzikPhase.P3,
        spawn: VerzikCrabSpawn.NORTH,
      });
    }
  });

  it('carries forward subtype from prev when this tick has none', () => {
    const previousEvents = tag(
      [
        createNpcSpawnEvent({
          tick: 0,
          roomId: 5,
          npcId: 8366,
          x: 10,
          y: 20,
          hitpointsCurrent: 75,
          maidenCrab: {
            spawn: MaidenCrabSpawn.SEVENTIES,
            position: MaidenCrabPosition.S1,
            scuffed: false,
          },
        }),
      ],
      7,
    );
    const previous = buildNpcsForTick(previousEvents, null);

    const currentEvents = tag(
      [
        createNpcUpdateEvent({
          tick: 1,
          roomId: 5,
          npcId: 8366,
          x: 10,
          y: 20,
          hitpointsCurrent: 72,
        }),
      ],
      7,
    );

    const subtype = buildNpcsForTick(currentEvents, previous).get(5)!.subtype!;
    expect(subtype.type).toBe(RoomNpcType.MAIDEN_CRAB);
    if (subtype.type === RoomNpcType.MAIDEN_CRAB) {
      expect(subtype.maidenCrab.position).toBe(MaidenCrabPosition.S1);
    }
  });

  it('overrides the carried subtype when this tick has fresh sub-type fields', () => {
    const previousEvents = tag(
      [
        createNpcSpawnEvent({
          tick: 0,
          roomId: 5,
          npcId: 8382,
          x: 10,
          y: 20,
          hitpointsCurrent: 11,
          verzikCrab: {
            phase: VerzikPhase.P2,
            spawn: VerzikCrabSpawn.NORTH,
          },
        }),
      ],
      7,
    );
    const previous = buildNpcsForTick(previousEvents, null);

    const currentEvents = tag(
      [
        createNpcUpdateEvent({
          tick: 1,
          roomId: 5,
          npcId: 8382,
          x: 10,
          y: 20,
          hitpointsCurrent: 11,
          verzikCrab: {
            phase: VerzikPhase.P3,
            spawn: VerzikCrabSpawn.NORTH,
          },
        }),
      ],
      7,
    );

    const subtype = buildNpcsForTick(currentEvents, previous).get(5)!.subtype!;
    expect(subtype.type).toBe(RoomNpcType.VERZIK_CRAB);
    if (subtype.type === RoomNpcType.VERZIK_CRAB) {
      expect(subtype.verzikCrab.phase).toBe(VerzikPhase.P3);
    }
  });

  it('returns null subtype when neither this tick nor prev has one', () => {
    const events = tag(
      [
        createNpcSpawnEvent({
          tick: 0,
          roomId: 5,
          npcId: 8360,
          x: 10,
          y: 20,
          hitpointsCurrent: 500,
        }),
      ],
      7,
    );
    expect(buildNpcsForTick(events, null).get(5)!.subtype).toBeNull();
  });
});

describe('buildNpcStates', () => {
  it('threads subtype carry-forward across the tick array', () => {
    const tickEvents: TaggedEvent[][] = [
      tag(
        [
          createNpcSpawnEvent({
            tick: 0,
            roomId: 5,
            npcId: 8366,
            x: 10,
            y: 20,
            hitpointsCurrent: 75,
            maidenCrab: {
              spawn: MaidenCrabSpawn.SEVENTIES,
              position: MaidenCrabPosition.S1,
              scuffed: false,
            },
          }),
        ],
        7,
      ),
      tag(
        [
          createNpcUpdateEvent({
            tick: 1,
            roomId: 5,
            npcId: 8366,
            x: 10,
            y: 20,
            hitpointsCurrent: 72,
          }),
        ],
        7,
      ),
      tag(
        [
          createNpcUpdateEvent({
            tick: 2,
            roomId: 5,
            npcId: 8366,
            x: 10,
            y: 20,
            hitpointsCurrent: 69,
          }),
        ],
        7,
      ),
    ];

    const result = buildNpcStates(tickEvents);

    expect(result).toHaveLength(3);
    for (let t = 0; t < 3; t++) {
      const subtype = result[t].get(5)!.subtype!;
      expect(subtype.type).toBe(RoomNpcType.MAIDEN_CRAB);
      if (subtype.type === RoomNpcType.MAIDEN_CRAB) {
        expect(subtype.maidenCrab.position).toBe(MaidenCrabPosition.S1);
      }
    }
  });

  it('produces an empty map for ticks with no NPC events', () => {
    const result = buildNpcStates([[], []]);
    expect(result).toHaveLength(2);
    expect(result[0].size).toBe(0);
    expect(result[1].size).toBe(0);
  });
});
