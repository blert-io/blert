/**
 * Conversion functions from Protobuf to JSON types.
 */
import { Event as EventProto } from '../generated/event_pb';

import {
  BloatDownEvent,
  BloatHandsDropEvent,
  BloatHandsSplatEvent,
  BaseEvent,
  ColosseumTotemHealEvent,
  ColosseumReentryPoolsEvent,
  ColosseumSolDustEvent,
  ColosseumSolGrappleEvent,
  ColosseumSolPoolsEvent,
  ColosseumSolLasersEvent,
  Event,
  EventType,
  MaidenBloodSplatsEvent,
  MokhaiotlAttackStyleEvent,
  MokhaiotlLarvaLeakEvent,
  MokhaiotlObjectsEvent,
  MokhaiotlOrbEvent,
  MokhaiotlShockwaveEvent,
  NpcAttackEvent,
  NpcEvent,
  NyloWaveSpawnEvent,
  NyloWaveStallEvent,
  PlayerAttackEvent,
  PlayerDeathEvent,
  PlayerSpellEvent,
  PlayerUpdateEvent,
  SoteMazeEvent,
  SoteMazePathEvent,
  Spell,
  SpellTarget,
  VerzikAttackStyleEvent,
  VerzikBounceEvent,
  VerzikDawnDropEvent,
  VerzikDawnEvent,
  VerzikHealEvent,
  VerzikPhaseEvent,
  VerzikYellowsEvent,
  XarpusExhumedEvent,
  XarpusPhaseEvent,
  XarpusSplatEvent,
} from '../event';

/**
 * Converts an Event protobuf to a JSON Event object.
 *
 * Player names must already be set on the proto (i.e. any partyIndex-based
 * name resolution should be done before calling this function).
 *
 * @param evt Event protobuf object.
 * @returns Internal Event object.
 */
export function protoToJsonEvent(evt: EventProto): Event {
  const event: Partial<BaseEvent> = {
    type: evt.getType(),
    stage: evt.getStage(),
    tick: evt.getTick(),
    xCoord: evt.getXCoord(),
    yCoord: evt.getYCoord(),
  };

  switch (evt.getType()) {
    case EventType.PLAYER_UPDATE: {
      const player = evt.getPlayer()!;
      const e = event as PlayerUpdateEvent;
      e.player = {
        source: player.getDataSource(),
        offCooldownTick: player.getOffCooldownTick(),
        prayerSet: player.getActivePrayers(),
        name: player.getName(),
      };
      if (player.hasHitpoints()) {
        e.player.hitpoints = player.getHitpoints();
      }
      if (player.hasPrayer()) {
        e.player.prayer = player.getPrayer();
      }
      if (player.hasAttack()) {
        e.player.attack = player.getAttack();
      }
      if (player.hasStrength()) {
        e.player.strength = player.getStrength();
      }
      if (player.hasDefence()) {
        e.player.defence = player.getDefence();
      }
      if (player.hasRanged()) {
        e.player.ranged = player.getRanged();
      }
      if (player.hasMagic()) {
        e.player.magic = player.getMagic();
      }
      const equipmentDeltas = player.getEquipmentDeltasList();
      if (equipmentDeltas.length > 0) {
        e.player.equipmentDeltas = equipmentDeltas;
      }
      break;
    }

    case EventType.PLAYER_ATTACK: {
      const attack = evt.getPlayerAttack()!;
      const e = event as PlayerAttackEvent;
      e.player = { name: evt.getPlayer()!.getName() };
      e.attack = {
        type: attack.getType(),
        distanceToTarget: attack.getDistanceToTarget(),
      };

      if (attack.hasWeapon()) {
        const weapon = attack.getWeapon()!;
        e.attack.weapon = {
          id: weapon.getId(),
          quantity: weapon.getQuantity(),
          name: '', // Populated on the frontend.
        };
      }

      if (attack.hasTarget()) {
        const target = attack.getTarget()!;
        e.attack.target = {
          id: target.getId(),
          roomId: target.getRoomId(),
        };
      }
      break;
    }

    case EventType.PLAYER_SPELL: {
      const spell = evt.getPlayerSpell()!;
      const e = event as PlayerSpellEvent;
      e.player = { name: evt.getPlayer()!.getName() };

      let target: Spell['target'];
      switch (spell.getTargetCase()) {
        case EventProto.Spell.TargetCase.TARGET_PLAYER:
          target = {
            type: SpellTarget.PLAYER,
            player: spell.getTargetPlayer(),
          };
          break;
        case EventProto.Spell.TargetCase.TARGET_NPC: {
          const npc = spell.getTargetNpc()!;
          target = {
            type: SpellTarget.NPC,
            npc: { id: npc.getId(), roomId: npc.getRoomId() },
          };
          break;
        }
        default:
          target = { type: SpellTarget.NONE };
          break;
      }

      e.spell = {
        type: spell.getType(),
        target,
      };
      break;
    }

    case EventType.PLAYER_DEATH: {
      const e = event as PlayerDeathEvent;
      e.player = { name: evt.getPlayer()!.getName() };
      break;
    }

    case EventType.NPC_SPAWN:
    case EventType.NPC_DEATH:
    case EventType.NPC_UPDATE:
    case EventType.TOB_MAIDEN_CRAB_LEAK: {
      const npc = evt.getNpc()!;
      const e = event as NpcEvent;
      e.npc = {
        id: npc.getId(),
        roomId: npc.getRoomId(),
        hitpoints: npc.getHitpoints(),
        prayers: npc.getActivePrayers(),
      };
      if (npc.hasMaidenCrab()) {
        e.npc.maidenCrab = npc.getMaidenCrab()!.toObject();
      } else if (npc.hasNylo()) {
        e.npc.nylo = npc.getNylo()!.toObject();
      } else if (npc.hasVerzikCrab()) {
        e.npc.verzikCrab = npc.getVerzikCrab()!.toObject();
      }
      break;
    }

    case EventType.NPC_ATTACK: {
      const npc = evt.getNpc()!;
      const npcAttack = evt.getNpcAttack()!;
      const e = event as NpcAttackEvent;
      e.npc = {
        id: npc.getId(),
        roomId: npc.getRoomId(),
      };
      e.npcAttack = {
        attack: npcAttack.getAttack(),
      };

      if (npcAttack.hasTarget()) {
        e.npcAttack.target = npcAttack.getTarget();
      }
      break;
    }

    case EventType.TOB_MAIDEN_BLOOD_SPLATS: {
      const e = event as MaidenBloodSplatsEvent;
      e.maidenBloodSplats = evt.getMaidenBloodSplatsList().map((splat) => ({
        x: splat.getX(),
        y: splat.getY(),
      }));
      break;
    }

    case EventType.TOB_BLOAT_DOWN: {
      const bloatDown = evt.getBloatDown()!;
      const e = event as BloatDownEvent;
      e.bloatDown = {
        downNumber: bloatDown.getDownNumber(),
        walkTime: bloatDown.getWalkTime(),
      };
      break;
    }

    case EventType.TOB_BLOAT_HANDS_DROP:
    case EventType.TOB_BLOAT_HANDS_SPLAT: {
      const e = event as BloatHandsDropEvent | BloatHandsSplatEvent;
      e.bloatHands = evt.getBloatHandsList().map((hand) => ({
        x: hand.getX(),
        y: hand.getY(),
      }));
      break;
    }

    case EventType.TOB_NYLO_WAVE_SPAWN:
    case EventType.TOB_NYLO_WAVE_STALL: {
      const nyloWave = evt.getNyloWave()!;
      const e = event as NyloWaveStallEvent | NyloWaveSpawnEvent;
      e.nyloWave = {
        wave: nyloWave.getWave(),
        nylosAlive: nyloWave.getNylosAlive(),
        roomCap: nyloWave.getRoomCap(),
      };
      break;
    }

    case EventType.TOB_NYLO_CLEANUP_END:
    case EventType.TOB_NYLO_BOSS_SPAWN:
      // No extra data.
      break;

    case EventType.TOB_SOTE_MAZE_PROC:
    case EventType.TOB_SOTE_MAZE_END: {
      const maze = evt.getSoteMaze()!;
      const e = event as SoteMazeEvent;
      e.soteMaze = { maze: maze.getMaze() };
      break;
    }

    case EventType.TOB_SOTE_MAZE_PATH: {
      const maze = evt.getSoteMaze()!;
      const e = event as SoteMazePathEvent;
      e.soteMaze = {
        maze: maze.getMaze(),
        activeTiles: maze.getOverworldTilesList().map((tile) => ({
          x: tile.getX(),
          y: tile.getY(),
        })),
      };
      break;
    }

    case EventType.TOB_XARPUS_PHASE: {
      const e = event as XarpusPhaseEvent;
      e.xarpusPhase = evt.getXarpusPhase();
      break;
    }

    case EventType.TOB_XARPUS_EXHUMED: {
      const xarpusExhumed = evt.getXarpusExhumed()!;
      const e = event as XarpusExhumedEvent;
      e.xarpusExhumed = {
        spawnTick: xarpusExhumed.getSpawnTick(),
        healAmount: xarpusExhumed.getHealAmount(),
        healTicks: xarpusExhumed.getHealTicksList(),
      };
      break;
    }

    case EventType.TOB_XARPUS_SPLAT: {
      const xarpusSplat = evt.getXarpusSplat()!;
      const e = event as XarpusSplatEvent;
      e.xarpusSplat = {
        source: xarpusSplat.getSource(),
        bounceFrom: xarpusSplat.hasBounceFrom()
          ? {
              x: xarpusSplat.getBounceFrom()!.getX(),
              y: xarpusSplat.getBounceFrom()!.getY(),
            }
          : null,
      };
      break;
    }

    case EventType.TOB_VERZIK_PHASE: {
      const e = event as VerzikPhaseEvent;
      e.verzikPhase = evt.getVerzikPhase();
      break;
    }

    case EventType.TOB_VERZIK_DAWN: {
      const verzikDawn = evt.getVerzikDawn()!;
      const e = event as VerzikDawnEvent;
      e.verzikDawn = {
        attackTick: verzikDawn.getAttackTick(),
        damage: verzikDawn.getDamage(),
        player: verzikDawn.getPlayer(),
      };
      break;
    }

    case EventType.TOB_VERZIK_YELLOWS: {
      const e = event as VerzikYellowsEvent;
      e.verzikYellows = evt.getVerzikYellowsList().map((yellow) => ({
        x: yellow.getX(),
        y: yellow.getY(),
      }));
      break;
    }

    case EventType.TOB_VERZIK_HEAL: {
      const verzikHeal = evt.getVerzikHeal()!;
      const e = event as VerzikHealEvent;
      e.verzikHeal = {
        player: verzikHeal.getPlayer(),
        healAmount: verzikHeal.getHealAmount(),
      };
      break;
    }

    case EventType.TOB_VERZIK_DAWN_DROP: {
      const verzikDawnDrop = evt.getVerzikDawnDrop()!;
      const e = event as VerzikDawnDropEvent;
      e.verzikDawnDrop = {
        dropped: verzikDawnDrop.getDropped(),
      };
      break;
    }

    case EventType.TOB_VERZIK_ATTACK_STYLE: {
      const verzikAttackStyle = evt.getVerzikAttackStyle()!;
      const e = event as VerzikAttackStyleEvent;
      e.verzikAttack = {
        style: verzikAttackStyle.getStyle(),
        npcAttackTick: verzikAttackStyle.getNpcAttackTick(),
      };
      break;
    }

    case EventType.COLOSSEUM_HANDICAP_CHOICE:
      break;

    case EventType.TOB_VERZIK_BOUNCE: {
      const verzikBounce = evt.getVerzikBounce()!;
      const e = event as VerzikBounceEvent;
      e.verzikBounce = {
        npcAttackTick: verzikBounce.getNpcAttackTick(),
        playersInRange: verzikBounce.getPlayersInRange(),
        playersNotInRange: verzikBounce.getPlayersNotInRange(),
      };
      if (verzikBounce.hasBouncedPlayer()) {
        e.verzikBounce.bouncedPlayer = verzikBounce.getBouncedPlayer();
      }
      break;
    }

    case EventType.COLOSSEUM_TOTEM_HEAL: {
      const e = event as ColosseumTotemHealEvent;
      const totemHeal = evt.getColosseumTotemHeal()!;
      const source = totemHeal.getSource()!;
      const target = totemHeal.getTarget()!;
      e.colosseumTotemHeal = {
        source: { id: source.getId(), roomId: source.getRoomId() },
        target: { id: target.getId(), roomId: target.getRoomId() },
        startTick: totemHeal.getStartTick(),
        healAmount: totemHeal.getHealAmount(),
      };
      break;
    }

    case EventType.COLOSSEUM_REENTRY_POOLS: {
      const e = event as ColosseumReentryPoolsEvent;
      const reentryPools = evt.getColosseumReentryPools()!;
      e.colosseumReentryPools = {
        primarySpawned: reentryPools
          .getPrimarySpawnedList()
          .map((coord) => coord.toObject()),
        secondarySpawned: reentryPools
          .getSecondarySpawnedList()
          .map((coord) => coord.toObject()),
        primaryDespawned: reentryPools
          .getPrimaryDespawnedList()
          .map((coord) => coord.toObject()),
        secondaryDespawned: reentryPools
          .getSecondaryDespawnedList()
          .map((coord) => coord.toObject()),
      };
      break;
    }

    case EventType.COLOSSEUM_SOL_DUST: {
      const e = event as ColosseumSolDustEvent;
      const solDust = evt.getColosseumSolDust()!;
      e.colosseumSolDust = {
        pattern: solDust.getPattern(),
        direction: solDust.getDirection(),
      };
      break;
    }

    case EventType.COLOSSEUM_SOL_GRAPPLE: {
      const e = event as ColosseumSolGrappleEvent;
      const solGrapple = evt.getColosseumSolGrapple()!;
      e.colosseumSolGrapple = {
        attackTick: solGrapple.getAttackTick(),
        target: solGrapple.getTarget(),
        outcome: solGrapple.getOutcome(),
      };
      break;
    }

    case EventType.COLOSSEUM_SOL_POOLS: {
      const e = event as ColosseumSolPoolsEvent;
      const solPools = evt.getColosseumSolPools()!;
      e.colosseumSolPools = {
        pools: solPools.getPoolsList().map((coord) => coord.toObject()),
      };
      break;
    }

    case EventType.COLOSSEUM_SOL_LASERS: {
      const e = event as ColosseumSolLasersEvent;
      const solLasers = evt.getColosseumSolLasers()!;
      e.colosseumSolLasers = {
        phase: solLasers.getPhase(),
      };
      break;
    }

    case EventType.MOKHAIOTL_ORB: {
      const e = event as MokhaiotlOrbEvent;
      const orb = evt.getMokhaiotlOrb()!;
      e.mokhaiotlOrb = {
        source: orb.getSource(),
        sourcePoint: orb.getSourcePoint()!.toObject(),
        style: orb.getStyle(),
        startTick: orb.getStartTick(),
        endTick: orb.getEndTick(),
      };
      break;
    }

    case EventType.MOKHAIOTL_OBJECTS: {
      const e = event as MokhaiotlObjectsEvent;
      const objects = evt.getMokhaiotlObjects()!;
      e.mokhaiotlObjects = {
        rocksSpawned: objects
          .getRocksSpawnedList()
          .map((rock) => rock.toObject()),
        rocksDespawned: objects
          .getRocksDespawnedList()
          .map((rock) => rock.toObject()),
        splatsSpawned: objects
          .getSplatsSpawnedList()
          .map((splat) => splat.toObject()),
        splatsDespawned: objects
          .getSplatsDespawnedList()
          .map((splat) => splat.toObject()),
      };
      break;
    }

    case EventType.MOKHAIOTL_LARVA_LEAK: {
      const e = event as MokhaiotlLarvaLeakEvent;
      const larvaLeak = evt.getMokhaiotlLarvaLeak()!;
      e.mokhaiotlLarvaLeak = {
        roomId: larvaLeak.getRoomId(),
        healAmount: larvaLeak.getHealAmount(),
      };
      break;
    }

    case EventType.MOKHAIOTL_ATTACK_STYLE: {
      const mokhaiotlAttackStyle = evt.getMokhaiotlAttackStyle()!;
      const e = event as MokhaiotlAttackStyleEvent;
      e.mokhaiotlAttackStyle = {
        style: mokhaiotlAttackStyle.getStyle(),
        npcAttackTick: mokhaiotlAttackStyle.getNpcAttackTick(),
      };
      break;
    }

    case EventType.MOKHAIOTL_SHOCKWAVE: {
      const e = event as MokhaiotlShockwaveEvent;
      const shockwave = evt.getMokhaiotlShockwave()!;
      e.mokhaiotlShockwave = {
        tiles: shockwave.getTilesList().map((tile) => tile.toObject()),
      };
      break;
    }
  }

  return event as Event;
}
