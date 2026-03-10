import { Empty } from 'google-protobuf/google/protobuf/empty_pb';

import { Stage } from '../challenge';
import {
  BloatDownEvent,
  ColosseumReentryPoolsEvent,
  ColosseumSolDustEvent,
  ColosseumSolGrappleEvent,
  ColosseumSolLasersEvent,
  ColosseumSolPoolsEvent,
  ColosseumTotemHealEvent,
  EventType,
  MaidenBloodSplatsEvent,
  NpcAttackEvent,
  NpcEvent,
  NyloWaveSpawnEvent,
  PlayerAttackEvent,
  PlayerDeathEvent,
  PlayerSpellEvent,
  PlayerUpdateEvent,
  SoteMazePathEvent,
  SpellTarget,
  VerzikBounceEvent,
  VerzikDawnDropEvent,
  VerzikDawnEvent,
  VerzikHealEvent,
  VerzikPhaseEvent,
  XarpusExhumedEvent,
  XarpusSplatEvent,
} from '../event';
import { Coords, Event as EventProto, StageMap } from '../generated/event_pb';
import { protoToJsonEvent } from '../protocol/proto-converter';

function makeEvent(
  type: EventType,
  overrides?: Partial<{ stage: Stage; tick: number; x: number; y: number }>,
): EventProto {
  const evt = new EventProto();
  evt.setType(type as EventProto.TypeMap[keyof EventProto.TypeMap]);
  evt.setStage(overrides?.stage as StageMap[keyof StageMap]);
  evt.setTick(overrides?.tick ?? 1);
  evt.setXCoord(overrides?.x ?? 0);
  evt.setYCoord(overrides?.y ?? 0);
  return evt;
}

function makePlayer(name: string): EventProto.Player {
  const player = new EventProto.Player();
  player.setName(name);
  return player;
}

function makeCoords(x: number, y: number): Coords {
  const coords = new Coords();
  coords.setX(x);
  coords.setY(y);
  return coords;
}

describe('protoToJsonEvent', () => {
  it('converts base event fields', () => {
    const evt = makeEvent(EventType.COLOSSEUM_DOOM_APPLIED, {
      stage: 12,
      tick: 50,
      x: 1600,
      y: 3200,
    });

    const result = protoToJsonEvent(evt);

    expect(result.type).toBe(EventType.COLOSSEUM_DOOM_APPLIED);
    expect(result.stage).toBe(12);
    expect(result.tick).toBe(50);
    expect(result.xCoord).toBe(1600);
    expect(result.yCoord).toBe(3200);
  });

  describe('player events', () => {
    it('converts PLAYER_UPDATE', () => {
      const evt = makeEvent(EventType.PLAYER_UPDATE);
      const player = makePlayer('TestPlayer');
      player.setDataSource(1);
      player.setOffCooldownTick(105);
      player.setActivePrayers(262144);
      player.setHitpoints(200674294);
      player.setPrayer(77);
      player.setAttack(99);
      player.setStrength(99);
      player.setDefence(99);
      player.setRanged(99);
      player.setMagic(99);
      player.setEquipmentDeltasList([1234, 5678]);
      evt.setPlayer(player);

      const result = protoToJsonEvent(evt) as PlayerUpdateEvent;

      expect(result.player.name).toBe('TestPlayer');
      expect(result.player.source).toBe(1);
      expect(result.player.offCooldownTick).toBe(105);
      expect(result.player.prayerSet).toBe(262144);
      expect(result.player.hitpoints).toBe(200674294);
      expect(result.player.prayer).toBe(77);
      expect(result.player.attack).toBe(99);
      expect(result.player.defence).toBe(99);
      expect(result.player.equipmentDeltas).toEqual([1234, 5678]);
    });

    it('omits optional stats when not set', () => {
      const evt = makeEvent(EventType.PLAYER_UPDATE);
      const player = makePlayer('TestPlayer');
      evt.setPlayer(player);

      const result = protoToJsonEvent(evt) as PlayerUpdateEvent;

      expect(result.player.hitpoints).toBeUndefined();
      expect(result.player.prayer).toBeUndefined();
      expect(result.player.equipmentDeltas).toBeUndefined();
    });

    it('converts PLAYER_ATTACK with weapon and target', () => {
      const evt = makeEvent(EventType.PLAYER_ATTACK);
      evt.setPlayer(makePlayer('TestPlayer'));

      const attack = new EventProto.Attack();
      attack.setType(12);
      attack.setDistanceToTarget(5);

      const weapon = new EventProto.Player.EquippedItem();
      weapon.setId(28688);
      weapon.setQuantity(1);
      attack.setWeapon(weapon);

      const target = new EventProto.Npc();
      target.setId(10792);
      target.setRoomId(59422);
      attack.setTarget(target);

      evt.setPlayerAttack(attack);

      const result = protoToJsonEvent(evt) as PlayerAttackEvent;

      expect(result.player.name).toBe('TestPlayer');
      expect(result.attack.type).toBe(12);
      expect(result.attack.distanceToTarget).toBe(5);
      expect(result.attack.weapon?.id).toBe(28688);
      expect(result.attack.target?.id).toBe(10792);
      expect(result.attack.target?.roomId).toBe(59422);
    });

    it('converts PLAYER_DEATH', () => {
      const evt = makeEvent(EventType.PLAYER_DEATH);
      evt.setPlayer(makePlayer('TestPlayer'));

      const result = protoToJsonEvent(evt) as PlayerDeathEvent;

      expect(result.player.name).toBe('TestPlayer');
    });
  });

  describe('player spell events', () => {
    it('converts spell with player target', () => {
      const evt = makeEvent(EventType.PLAYER_SPELL);
      evt.setPlayer(makePlayer('Caster'));

      const spell = new EventProto.Spell();
      spell.setType(10);
      spell.setTargetPlayer('OtherPlayer');
      evt.setPlayerSpell(spell);

      const result = protoToJsonEvent(evt) as PlayerSpellEvent;

      expect(result.spell.type).toBe(10);
      expect(result.spell.target.type).toBe(SpellTarget.PLAYER);
      if (result.spell.target.type === SpellTarget.PLAYER) {
        expect(result.spell.target.player).toBe('OtherPlayer');
      }
    });

    it('converts spell with NPC target', () => {
      const evt = makeEvent(EventType.PLAYER_SPELL);
      evt.setPlayer(makePlayer('Caster'));

      const spell = new EventProto.Spell();
      spell.setType(11);
      const npc = new EventProto.Npc();
      npc.setId(10847);
      npc.setRoomId(12345);
      spell.setTargetNpc(npc);
      evt.setPlayerSpell(spell);

      const result = protoToJsonEvent(evt) as PlayerSpellEvent;

      expect(result.spell.type).toBe(11);
      expect(result.spell.target.type).toBe(SpellTarget.NPC);
      if (result.spell.target.type === SpellTarget.NPC) {
        expect(result.spell.target.npc.id).toBe(10847);
      }
    });

    it('converts spell with no target', () => {
      const evt = makeEvent(EventType.PLAYER_SPELL);
      evt.setPlayer(makePlayer('Caster'));

      const spell = new EventProto.Spell();
      spell.setType(10);
      spell.setNoTarget(new Empty());
      evt.setPlayerSpell(spell);

      const result = protoToJsonEvent(evt) as PlayerSpellEvent;

      expect(result.spell.target.type).toBe(SpellTarget.NONE);
    });
  });

  describe('NPC events', () => {
    it('converts NPC_SPAWN', () => {
      const evt = makeEvent(EventType.NPC_SPAWN);
      const npc = new EventProto.Npc();
      npc.setId(10792);
      npc.setRoomId(59422);
      npc.setHitpoints(589833);
      npc.setActivePrayers(0);
      evt.setNpc(npc);

      const result = protoToJsonEvent(evt) as NpcEvent;

      expect(result.npc.id).toBe(10792);
      expect(result.npc.roomId).toBe(59422);
      expect(result.npc.hitpoints).toBe(589833);
    });

    it('converts NPC_ATTACK with target', () => {
      const evt = makeEvent(EventType.NPC_ATTACK);
      const npc = new EventProto.Npc();
      npc.setId(10792);
      npc.setRoomId(59422);
      evt.setNpc(npc);

      const npcAttack = new EventProto.NpcAttacked();
      npcAttack.setAttack(3);
      npcAttack.setTarget('TestPlayer');
      evt.setNpcAttack(npcAttack);

      const result = protoToJsonEvent(evt) as NpcAttackEvent;

      expect(result.npc.id).toBe(10792);
      expect(result.npcAttack.attack).toBe(3);
      expect(result.npcAttack.target).toBe('TestPlayer');
    });

    it('converts NPC_ATTACK without target', () => {
      const evt = makeEvent(EventType.NPC_ATTACK);
      const npc = new EventProto.Npc();
      npc.setId(10792);
      npc.setRoomId(59422);
      evt.setNpc(npc);

      const npcAttack = new EventProto.NpcAttacked();
      npcAttack.setAttack(3);
      evt.setNpcAttack(npcAttack);

      const result = protoToJsonEvent(evt) as NpcAttackEvent;

      expect(result.npcAttack.target).toBeUndefined();
    });
  });

  describe('ToB events', () => {
    it('converts maiden blood splats', () => {
      const evt = makeEvent(EventType.TOB_MAIDEN_BLOOD_SPLATS, { stage: 10 });
      evt.setMaidenBloodSplatsList([
        makeCoords(3160, 4435),
        makeCoords(3161, 4436),
      ]);

      const result = protoToJsonEvent(evt) as MaidenBloodSplatsEvent;

      expect(result.maidenBloodSplats).toHaveLength(2);
      expect(result.maidenBloodSplats[0]).toEqual({ x: 3160, y: 4435 });
    });

    it('converts bloat down', () => {
      const evt = makeEvent(EventType.TOB_BLOAT_DOWN, { stage: 11 });
      const down = new EventProto.BloatDown();
      down.setDownNumber(1);
      down.setWalkTime(32);
      evt.setBloatDown(down);

      const result = protoToJsonEvent(evt) as BloatDownEvent;

      expect(result.bloatDown.downNumber).toBe(1);
      expect(result.bloatDown.walkTime).toBe(32);
    });

    it('converts nylo wave spawn', () => {
      const evt = makeEvent(EventType.TOB_NYLO_WAVE_SPAWN, { stage: 12 });
      const wave = new EventProto.NyloWave();
      wave.setWave(1);
      wave.setNylosAlive(0);
      wave.setRoomCap(12);
      evt.setNyloWave(wave);

      const result = protoToJsonEvent(evt) as NyloWaveSpawnEvent;

      expect(result.nyloWave.wave).toBe(1);
      expect(result.nyloWave.roomCap).toBe(12);
    });

    it('converts sote maze path', () => {
      const evt = makeEvent(EventType.TOB_SOTE_MAZE_PATH, { stage: 13 });
      const maze = new EventProto.SoteMaze();
      maze.setMaze(1);
      maze.setOverworldTilesList([makeCoords(10, 20), makeCoords(11, 21)]);
      evt.setSoteMaze(maze);

      const result = protoToJsonEvent(evt) as SoteMazePathEvent;

      expect(result.soteMaze.maze).toBe(1);
      expect(result.soteMaze.activeTiles).toHaveLength(2);
      expect(result.soteMaze.activeTiles[0]).toEqual({ x: 10, y: 20 });
    });

    it('converts xarpus exhumed', () => {
      const evt = makeEvent(EventType.TOB_XARPUS_EXHUMED, { stage: 14 });
      const exhumed = new EventProto.XarpusExhumed();
      exhumed.setSpawnTick(5);
      exhumed.setHealAmount(10);
      exhumed.setHealTicksList([6, 7, 8]);
      evt.setXarpusExhumed(exhumed);

      const result = protoToJsonEvent(evt) as XarpusExhumedEvent;

      expect(result.xarpusExhumed.spawnTick).toBe(5);
      expect(result.xarpusExhumed.healAmount).toBe(10);
      expect(result.xarpusExhumed.healTicks).toEqual([6, 7, 8]);
    });

    it('converts xarpus splat with bounce', () => {
      const evt = makeEvent(EventType.TOB_XARPUS_SPLAT, { stage: 14 });
      const splat = new EventProto.XarpusSplat();
      splat.setSource(1);
      splat.setBounceFrom(makeCoords(3160, 4435));
      evt.setXarpusSplat(splat);

      const result = protoToJsonEvent(evt) as XarpusSplatEvent;

      expect(result.xarpusSplat.source).toBe(1);
      expect(result.xarpusSplat.bounceFrom).toEqual({ x: 3160, y: 4435 });
    });

    it('converts xarpus splat without bounce', () => {
      const evt = makeEvent(EventType.TOB_XARPUS_SPLAT, { stage: 14 });
      const splat = new EventProto.XarpusSplat();
      splat.setSource(0);
      evt.setXarpusSplat(splat);

      const result = protoToJsonEvent(evt) as XarpusSplatEvent;

      expect(result.xarpusSplat.bounceFrom).toBeNull();
    });

    it('converts verzik phase', () => {
      const evt = makeEvent(EventType.TOB_VERZIK_PHASE);
      evt.setVerzikPhase(2);

      const result = protoToJsonEvent(evt) as VerzikPhaseEvent;

      expect(result.verzikPhase).toBe(2);
    });

    it('converts verzik dawn', () => {
      const evt = makeEvent(EventType.TOB_VERZIK_DAWN);
      const dawn = new EventProto.VerzikDawn();
      dawn.setAttackTick(10);
      dawn.setDamage(50);
      dawn.setPlayer('TestPlayer');
      evt.setVerzikDawn(dawn);

      const result = protoToJsonEvent(evt) as VerzikDawnEvent;

      expect(result.verzikDawn.attackTick).toBe(10);
      expect(result.verzikDawn.damage).toBe(50);
      expect(result.verzikDawn.player).toBe('TestPlayer');
    });

    it('converts verzik dawn drop', () => {
      const evt = makeEvent(EventType.TOB_VERZIK_DAWN_DROP);
      const dawnDrop = new EventProto.VerzikDawnDrop();
      dawnDrop.setDropped(true);
      evt.setVerzikDawnDrop(dawnDrop);

      const result = protoToJsonEvent(evt) as VerzikDawnDropEvent;

      expect(result.verzikDawnDrop.dropped).toBe(true);
    });

    it('converts verzik heal', () => {
      const evt = makeEvent(EventType.TOB_VERZIK_HEAL);
      const heal = new EventProto.VerzikHeal();
      heal.setPlayer('TestPlayer');
      heal.setHealAmount(20);
      evt.setVerzikHeal(heal);

      const result = protoToJsonEvent(evt) as VerzikHealEvent;

      expect(result.verzikHeal.player).toBe('TestPlayer');
      expect(result.verzikHeal.healAmount).toBe(20);
    });

    it('converts verzik bounce with bounced player', () => {
      const evt = makeEvent(EventType.TOB_VERZIK_BOUNCE);
      const bounce = new EventProto.VerzikBounce();
      bounce.setNpcAttackTick(10);
      bounce.setPlayersInRange(3);
      bounce.setPlayersNotInRange(1);
      bounce.setBouncedPlayer('TestPlayer');
      evt.setVerzikBounce(bounce);

      const result = protoToJsonEvent(evt) as VerzikBounceEvent;

      expect(result.verzikBounce.npcAttackTick).toBe(10);
      expect(result.verzikBounce.playersInRange).toBe(3);
      expect(result.verzikBounce.playersNotInRange).toBe(1);
      expect(result.verzikBounce.bouncedPlayer).toBe('TestPlayer');
    });
  });

  describe('Colosseum events', () => {
    function makeNpc(id: number, roomId: number): EventProto.Npc {
      const npc = new EventProto.Npc();
      npc.setId(id);
      npc.setRoomId(roomId);
      return npc;
    }

    it('converts totem heal', () => {
      const evt = makeEvent(EventType.COLOSSEUM_TOTEM_HEAL);
      const totemHeal = new EventProto.ColosseumTotemHeal();
      totemHeal.setSource(makeNpc(12811, 100));
      totemHeal.setTarget(makeNpc(12812, 101));
      totemHeal.setStartTick(15);
      totemHeal.setHealAmount(8);
      evt.setColosseumTotemHeal(totemHeal);

      const result = protoToJsonEvent(evt) as ColosseumTotemHealEvent;

      expect(result.colosseumTotemHeal.source).toEqual({
        id: 12811,
        roomId: 100,
      });
      expect(result.colosseumTotemHeal.target).toEqual({
        id: 12812,
        roomId: 101,
      });
      expect(result.colosseumTotemHeal.startTick).toBe(15);
      expect(result.colosseumTotemHeal.healAmount).toBe(8);
    });

    it('converts reentry pools', () => {
      const evt = makeEvent(EventType.COLOSSEUM_REENTRY_POOLS);
      const pools = new EventProto.ColosseumReentryPools();
      pools.setPrimarySpawnedList([makeCoords(10, 20)]);
      pools.setSecondarySpawnedList([makeCoords(11, 21)]);
      pools.setPrimaryDespawnedList([makeCoords(12, 22)]);
      pools.setSecondaryDespawnedList([]);
      evt.setColosseumReentryPools(pools);

      const result = protoToJsonEvent(evt) as ColosseumReentryPoolsEvent;

      expect(result.colosseumReentryPools.primarySpawned).toEqual([
        { x: 10, y: 20 },
      ]);
      expect(result.colosseumReentryPools.secondarySpawned).toEqual([
        { x: 11, y: 21 },
      ]);
      expect(result.colosseumReentryPools.primaryDespawned).toEqual([
        { x: 12, y: 22 },
      ]);
      expect(result.colosseumReentryPools.secondaryDespawned).toEqual([]);
    });

    it('converts sol dust', () => {
      const evt = makeEvent(EventType.COLOSSEUM_SOL_DUST);
      const dust = new EventProto.ColosseumSolDust();
      dust.setPattern(2);
      dust.setDirection(1);
      evt.setColosseumSolDust(dust);

      const result = protoToJsonEvent(evt) as ColosseumSolDustEvent;

      expect(result.colosseumSolDust.pattern).toBe(2);
      expect(result.colosseumSolDust.direction).toBe(1);
    });

    it('converts sol grapple', () => {
      const evt = makeEvent(EventType.COLOSSEUM_SOL_GRAPPLE);
      const grapple = new EventProto.ColosseumSolGrapple();
      grapple.setAttackTick(42);
      grapple.setTarget(3);
      grapple.setOutcome(1);
      evt.setColosseumSolGrapple(grapple);

      const result = protoToJsonEvent(evt) as ColosseumSolGrappleEvent;

      expect(result.colosseumSolGrapple.attackTick).toBe(42);
      expect(result.colosseumSolGrapple.target).toBe(3);
      expect(result.colosseumSolGrapple.outcome).toBe(1);
    });

    it('converts sol pools', () => {
      const evt = makeEvent(EventType.COLOSSEUM_SOL_POOLS);
      const pools = new EventProto.ColosseumSolPools();
      pools.setPoolsList([makeCoords(30, 40), makeCoords(31, 41)]);
      evt.setColosseumSolPools(pools);

      const result = protoToJsonEvent(evt) as ColosseumSolPoolsEvent;

      expect(result.colosseumSolPools.pools).toHaveLength(2);
      expect(result.colosseumSolPools.pools[0]).toEqual({ x: 30, y: 40 });
    });

    it('converts sol lasers', () => {
      const evt = makeEvent(EventType.COLOSSEUM_SOL_LASERS);
      const lasers = new EventProto.ColosseumSolLasers();
      lasers.setPhase(2);
      evt.setColosseumSolLasers(lasers);

      const result = protoToJsonEvent(evt) as ColosseumSolLasersEvent;

      expect(result.colosseumSolLasers.phase).toBe(2);
    });
  });
});
