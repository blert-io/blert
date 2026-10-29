/**
 * Conversion functions between JSON and Protobuf message formats.
 */
import { Empty } from 'google-protobuf/google/protobuf/empty_pb';
import { Timestamp } from 'google-protobuf/google/protobuf/timestamp_pb';
import { z } from 'zod';

import { ChallengeMode, Coords, Event } from '../generated/event_pb';
import {
  AttackDefinition,
  ChallengeEndRequest,
  ChallengeStartRequest,
  ChallengeUpdate,
  RecordingConfig,
  RecordingInfo,
  ServerMessage,
  SpellDefinition,
} from '../generated/server_message_pb';

import {
  attackDefinitionSchema,
  EventJson,
  npcDefinitionSchema,
  npcSchema,
  objectCaptureSchema,
  pastChallengeSchema,
  projectileSchema,
  recordingConfigSchema,
  scopeSchema,
  ServerMessageJson,
  serverMessageSchema,
  spellDefinitionSchema,
  weaponProjectileSchema,
} from './json-schemas';

// Type alias for enum values (to avoid verbose casts everywhere).
/* eslint-disable @typescript-eslint/no-unsafe-argument */
type AnyEnum = any;

/**
 * Validates and converts a JSON object to a ServerMessage protobuf.
 * @param json Raw parsed JSON object.
 * @returns ServerMessage protobuf object.
 * @throws {z.ZodError} if validation fails
 */
export function jsonToServerMessage(json: unknown): ServerMessage {
  const validated = serverMessageSchema.parse(json);
  return serverMessageJsonToProto(validated);
}

function serverMessageJsonToProto(json: ServerMessageJson): ServerMessage {
  const msg = new ServerMessage();
  msg.setType(json.type as AnyEnum);

  if (json.user !== undefined) {
    const user = new ServerMessage.User();
    user.setId(json.user.id);
    user.setName(json.user.name);
    msg.setUser(user);
  }

  if (json.error !== undefined) {
    const error = new ServerMessage.Error();
    error.setType(json.error.type as AnyEnum);
    error.setUsername(json.error.username);
    if (json.error.message !== undefined) {
      error.setMessage(json.error.message);
    }
    msg.setError(error);
  }

  if (json.activeChallengeId !== undefined) {
    msg.setActiveChallengeId(json.activeChallengeId);
  }

  if (json.recentRecordings !== undefined) {
    const recordings = json.recentRecordings.map((r) => {
      const rec = new ServerMessage.PastChallenge();
      rec.setId(r.id);
      rec.setStatus(r.status as AnyEnum);
      rec.setStage(r.stage as AnyEnum);
      rec.setMode(r.mode as AnyEnum);
      rec.setPartyList(r.party);
      rec.setChallenge(r.challenge as AnyEnum);
      rec.setChallengeTicks(r.challengeTicks);
      if (r.timestamp !== undefined) {
        const timestamp = new Timestamp();
        timestamp.setSeconds(r.timestamp.seconds);
        timestamp.setNanos(r.timestamp.nanos);
        rec.setTimestamp(timestamp);
      }
      return rec;
    });
    msg.setRecentRecordingsList(recordings);
  }

  if (json.challengeEvents !== undefined) {
    const events = json.challengeEvents.map(jsonToProtoEvent);
    msg.setChallengeEventsList(events);
  }

  if (json.serverStatus !== undefined) {
    const status = new ServerMessage.ServerStatus();
    status.setStatus(json.serverStatus.status as AnyEnum);
    if (json.serverStatus.shutdownTime !== undefined) {
      const shutdownTime = new Timestamp();
      shutdownTime.setSeconds(json.serverStatus.shutdownTime.seconds);
      shutdownTime.setNanos(json.serverStatus.shutdownTime.nanos);
      status.setShutdownTime(shutdownTime);
    }
    msg.setServerStatus(status);
  }

  if (json.gameState !== undefined) {
    const state = new ServerMessage.GameState();
    state.setState(json.gameState.state as AnyEnum);
    if (json.gameState.playerInfo !== undefined) {
      const info = new ServerMessage.GameState.PlayerInfo();
      info.setUsername(json.gameState.playerInfo.username);
      info.setOverallExperience(json.gameState.playerInfo.overallExperience);
      info.setAttackExperience(json.gameState.playerInfo.attackExperience);
      info.setStrengthExperience(json.gameState.playerInfo.strengthExperience);
      info.setDefenceExperience(json.gameState.playerInfo.defenceExperience);
      info.setHitpointsExperience(
        json.gameState.playerInfo.hitpointsExperience,
      );
      info.setRangedExperience(json.gameState.playerInfo.rangedExperience);
      info.setPrayerExperience(json.gameState.playerInfo.prayerExperience);
      info.setMagicExperience(json.gameState.playerInfo.magicExperience);
      info.setAccountHash(json.gameState.playerInfo.accountHash);
      state.setPlayerInfo(info);
    }
    msg.setGameState(state);
  }

  if (json.playerState !== undefined) {
    const states = json.playerState.map((s) => {
      const state = new ServerMessage.PlayerState();
      state.setUsername(s.username);
      state.setChallengeId(s.challengeId);
      state.setChallenge(s.challenge as AnyEnum);
      state.setMode(s.mode as AnyEnum);
      return state;
    });
    msg.setPlayerStateList(states);
  }

  if (json.challengeStateConfirmation !== undefined) {
    const conf = new ServerMessage.ChallengeStateConfirmation();
    conf.setIsValid(json.challengeStateConfirmation.isValid);
    if (json.challengeStateConfirmation.username !== undefined) {
      conf.setUsername(json.challengeStateConfirmation.username);
    }
    if (json.challengeStateConfirmation.challenge !== undefined) {
      conf.setChallenge(json.challengeStateConfirmation.challenge as AnyEnum);
    }
    if (json.challengeStateConfirmation.mode !== undefined) {
      conf.setMode(json.challengeStateConfirmation.mode as AnyEnum);
    }
    if (json.challengeStateConfirmation.stage !== undefined) {
      conf.setStage(json.challengeStateConfirmation.stage as AnyEnum);
    }
    if (json.challengeStateConfirmation.party !== undefined) {
      conf.setPartyList(json.challengeStateConfirmation.party);
    }
    if (json.challengeStateConfirmation.spectator !== undefined) {
      conf.setSpectator(json.challengeStateConfirmation.spectator);
    }
    msg.setChallengeStateConfirmation(conf);
  }

  if (json.challengeStartRequest !== undefined) {
    const req = new ChallengeStartRequest();
    req.setChallenge(json.challengeStartRequest.challenge as AnyEnum);
    if (json.challengeStartRequest.mode !== undefined) {
      req.setMode(json.challengeStartRequest.mode as AnyEnum);
    }
    if (json.challengeStartRequest.stage !== undefined) {
      req.setStage(json.challengeStartRequest.stage as AnyEnum);
    }
    req.setPartyList(json.challengeStartRequest.party);
    req.setSpectator(json.challengeStartRequest.spectator);
    msg.setChallengeStartRequest(req);
  }

  if (json.challengeEndRequest !== undefined) {
    const req = new ChallengeEndRequest();
    req.setOverallTimeTicks(json.challengeEndRequest.overallTimeTicks);
    req.setChallengeTimeTicks(json.challengeEndRequest.challengeTimeTicks);
    if (json.challengeEndRequest.soft !== undefined) {
      req.setSoft(json.challengeEndRequest.soft);
    }
    msg.setChallengeEndRequest(req);
  }

  if (json.challengeUpdate !== undefined) {
    const update = new ChallengeUpdate();
    if (json.challengeUpdate.mode !== undefined) {
      update.setMode(json.challengeUpdate.mode as AnyEnum);
    }
    if (json.challengeUpdate.party !== undefined) {
      update.setPartyList(json.challengeUpdate.party);
    }
    if (json.challengeUpdate.stageUpdate !== undefined) {
      const stage = new ChallengeUpdate.StageUpdate();
      stage.setStage(json.challengeUpdate.stageUpdate.stage as AnyEnum);
      stage.setStatus(json.challengeUpdate.stageUpdate.status as AnyEnum);
      stage.setAccurate(json.challengeUpdate.stageUpdate.accurate);
      stage.setRecordedTicks(json.challengeUpdate.stageUpdate.recordedTicks);
      if (json.challengeUpdate.stageUpdate.gameServerTicks !== undefined) {
        stage.setGameServerTicks(
          json.challengeUpdate.stageUpdate.gameServerTicks,
        );
      }
      stage.setGameTicksPrecise(
        json.challengeUpdate.stageUpdate.gameTicksPrecise,
      );
      const overallTicks = json.challengeUpdate.stageUpdate.overallTicks;
      if (overallTicks !== undefined) {
        const overall = new ChallengeUpdate.StageUpdate.OverallTicks();
        if ('server' in overallTicks) {
          const server = new ChallengeUpdate.StageUpdate.OverallTicks.Server();
          server.setTicks(overallTicks.server.ticks);
          server.setPrecise(overallTicks.server.precise);
          overall.setServer(server);
        } else {
          overall.setLocal(overallTicks.local);
        }
        stage.setOverallTicks(overall);
      }
      update.setStageUpdate(stage);
    }
    msg.setChallengeUpdate(update);
  }

  if (json.attackDefinitions !== undefined) {
    const defs = json.attackDefinitions.map(attackDefinitionJsonToProto);
    msg.setAttackDefinitionsList(defs);
  }

  if (json.spellDefinitions !== undefined) {
    const defs = json.spellDefinitions.map(spellDefinitionJsonToProto);
    msg.setSpellDefinitionsList(defs);
  }

  if (json.recordingConfig !== undefined) {
    msg.setRecordingConfig(recordingConfigJsonToProto(json.recordingConfig));
  }

  if (json.recordingInfo !== undefined) {
    const info = new RecordingInfo();
    info.setStage(json.recordingInfo.stage as AnyEnum);
    info.setConfigVersion(json.recordingInfo.configVersion);
    msg.setRecordingInfo(info);
  }

  if (json.requestId !== undefined) {
    msg.setRequestId(json.requestId);
  }

  return msg;
}

export function jsonToProtoEvent(json: EventJson): Event {
  const event = new Event();
  event.setType(json.type as AnyEnum);
  if (json.challengeId !== undefined) {
    event.setChallengeId(json.challengeId);
  }
  event.setStage(json.stage as AnyEnum);
  event.setTick(json.tick);
  event.setXCoord(json.xCoord);
  event.setYCoord(json.yCoord);

  if (json.player !== undefined) {
    const player = new Event.Player();
    player.setName(json.player.name);
    if (json.player.offCooldownTick !== undefined) {
      player.setOffCooldownTick(json.player.offCooldownTick);
    }
    if (json.player.hitpoints !== undefined) {
      player.setHitpoints(json.player.hitpoints);
    }
    if (json.player.prayer !== undefined) {
      player.setPrayer(json.player.prayer);
    }
    if (json.player.attack !== undefined) {
      player.setAttack(json.player.attack);
    }
    if (json.player.strength !== undefined) {
      player.setStrength(json.player.strength);
    }
    if (json.player.defence !== undefined) {
      player.setDefence(json.player.defence);
    }
    if (json.player.ranged !== undefined) {
      player.setRanged(json.player.ranged);
    }
    if (json.player.magic !== undefined) {
      player.setMagic(json.player.magic);
    }
    if (json.player.equipmentDeltas !== undefined) {
      player.setEquipmentDeltasList(json.player.equipmentDeltas);
    }
    if (json.player.activePrayers !== undefined) {
      player.setActivePrayers(json.player.activePrayers);
    }
    if (json.player.dataSource !== undefined) {
      player.setDataSource(json.player.dataSource as AnyEnum);
    }
    if (json.player.partyIndex !== undefined) {
      player.setPartyIndex(json.player.partyIndex);
    }
    if (json.player.snapshot !== undefined) {
      player.setSnapshot(json.player.snapshot);
    }
    event.setPlayer(player);
  }

  if (json.playerAttack !== undefined) {
    const attack = new Event.Attack();
    attack.setType(json.playerAttack.type as AnyEnum);
    if (json.playerAttack.weapon !== undefined) {
      const weapon = new Event.Player.EquippedItem();
      weapon.setSlot(json.playerAttack.weapon.slot as AnyEnum);
      weapon.setId(json.playerAttack.weapon.id);
      weapon.setQuantity(json.playerAttack.weapon.quantity);
      attack.setWeapon(weapon);
    }
    if (json.playerAttack.target !== undefined) {
      attack.setTarget(npcJsonToProto(json.playerAttack.target));
    }
    attack.setDistanceToTarget(json.playerAttack.distanceToTarget);
    event.setPlayerAttack(attack);
  }

  if (json.npc !== undefined) {
    event.setNpc(npcJsonToProto(json.npc));
  }

  if (json.npcAttack !== undefined) {
    const attack = new Event.NpcAttacked();
    attack.setAttack(json.npcAttack.attack as AnyEnum);
    if (json.npcAttack.target !== undefined) {
      attack.setTarget(json.npcAttack.target);
    }
    event.setNpcAttack(attack);
  }

  if (json.playerSpell !== undefined) {
    const spell = new Event.Spell();
    spell.setType(json.playerSpell.type as AnyEnum);
    if (json.playerSpell.targetPlayer !== undefined) {
      spell.setTargetPlayer(json.playerSpell.targetPlayer);
    } else if (json.playerSpell.targetNpc !== undefined) {
      spell.setTargetNpc(npcJsonToProto(json.playerSpell.targetNpc));
    } else {
      spell.setNoTarget(new Empty());
    }
    event.setPlayerSpell(spell);
  }

  if (json.objects !== undefined) {
    const objects = new Event.Objects();
    if (json.objects.snapshot !== undefined) {
      objects.setSnapshot(json.objects.snapshot);
    }
    objects.setUpdatesList(
      json.objects.updates.map((update) => {
        const objectUpdate = new Event.ObjectUpdate();
        objectUpdate.setType(update.type as AnyEnum);
        objectUpdate.setId(update.id);
        objectUpdate.setAddedList(update.added.map(coordsJsonToProto));
        objectUpdate.setRemovedList(update.removed.map(coordsJsonToProto));
        if (update.snapshot !== undefined) {
          objectUpdate.setSnapshot(update.snapshot);
        }
        return objectUpdate;
      }),
    );
    event.setObjects(objects);
  }

  if (json.vars !== undefined) {
    const vars = new Event.Vars();
    vars.setVarbitsList((json.vars.varbits ?? []).map(varValueJsonToProto));
    vars.setVarpsList((json.vars.varps ?? []).map(varValueJsonToProto));
    event.setVars(vars);
  }

  // ToB events
  if (json.maidenBloodSplats !== undefined) {
    event.setMaidenBloodSplatsList(
      json.maidenBloodSplats.map(coordsJsonToProto),
    );
  }

  if (json.bloatDown !== undefined) {
    const down = new Event.BloatDown();
    down.setDownNumber(json.bloatDown.downNumber);
    down.setUpTicks(
      'upTicks' in json.bloatDown
        ? json.bloatDown.upTicks
        : json.bloatDown.walkTime,
    );
    event.setBloatDown(down);
  }

  if (json.bloatHands !== undefined) {
    event.setBloatHandsList(json.bloatHands.map(coordsJsonToProto));
  }

  if (json.nyloWave !== undefined) {
    const wave = new Event.NyloWave();
    wave.setWave(json.nyloWave.wave);
    wave.setNylosAlive(json.nyloWave.nylosAlive);
    wave.setRoomCap(json.nyloWave.roomCap);
    event.setNyloWave(wave);
  }

  if (json.soteMaze !== undefined) {
    const maze = new Event.SoteMaze();
    maze.setMaze(json.soteMaze.maze as AnyEnum);
    if (json.soteMaze.overworldTiles !== undefined) {
      maze.setOverworldTilesList(
        json.soteMaze.overworldTiles.map(coordsJsonToProto),
      );
    }
    if (json.soteMaze.overworldPivots !== undefined) {
      maze.setOverworldPivotsList(
        json.soteMaze.overworldPivots.map(coordsJsonToProto),
      );
    }
    if (json.soteMaze.underworldPivots !== undefined) {
      maze.setUnderworldPivotsList(
        json.soteMaze.underworldPivots.map(coordsJsonToProto),
      );
    }
    if (json.soteMaze.chosenPlayer !== undefined) {
      maze.setChosenPlayer(json.soteMaze.chosenPlayer);
    }
    event.setSoteMaze(maze);
  }

  if (json.xarpusPhase !== undefined) {
    event.setXarpusPhase(json.xarpusPhase as AnyEnum);
  }

  if (json.xarpusExhumed !== undefined) {
    const exhumed = new Event.XarpusExhumed();
    exhumed.setSpawnTick(json.xarpusExhumed.spawnTick);
    exhumed.setHealAmount(json.xarpusExhumed.healAmount);
    exhumed.setHealTicksList(json.xarpusExhumed.healTicks);
    event.setXarpusExhumed(exhumed);
  }

  if (json.xarpusSplat !== undefined) {
    const splat = new Event.XarpusSplat();
    splat.setSource(json.xarpusSplat.source as AnyEnum);
    if (json.xarpusSplat.bounceFrom !== undefined) {
      splat.setBounceFrom(coordsJsonToProto(json.xarpusSplat.bounceFrom));
    }
    event.setXarpusSplat(splat);
  }

  if (json.verzikPhase !== undefined) {
    event.setVerzikPhase(json.verzikPhase as AnyEnum);
  }

  if (json.verzikAttackStyle !== undefined) {
    const style = new Event.AttackStyle();
    style.setStyle(json.verzikAttackStyle.style as AnyEnum);
    style.setNpcAttackTick(json.verzikAttackStyle.npcAttackTick);
    event.setVerzikAttackStyle(style);
  }

  if (json.verzikYellows !== undefined) {
    event.setVerzikYellowsList(json.verzikYellows.map(coordsJsonToProto));
  }

  if (json.verzikBounce !== undefined) {
    const bounce = new Event.VerzikBounce();
    bounce.setNpcAttackTick(json.verzikBounce.npcAttackTick);
    bounce.setPlayersInRange(json.verzikBounce.playersInRange);
    bounce.setPlayersNotInRange(json.verzikBounce.playersNotInRange);
    if (json.verzikBounce.bouncedPlayer !== undefined) {
      bounce.setBouncedPlayer(json.verzikBounce.bouncedPlayer);
    }
    event.setVerzikBounce(bounce);
  }

  if (json.verzikHeal !== undefined) {
    const heal = new Event.VerzikHeal();
    heal.setPlayer(json.verzikHeal.player);
    heal.setHealAmount(json.verzikHeal.healAmount);
    event.setVerzikHeal(heal);
  }

  if (json.verzikDawn !== undefined) {
    const dawn = new Event.VerzikDawn();
    dawn.setAttackTick(json.verzikDawn.attackTick);
    dawn.setDamage(json.verzikDawn.damage);
    dawn.setPlayer(json.verzikDawn.player);
    event.setVerzikDawn(dawn);
  }

  if (json.verzikDawnDrop !== undefined) {
    const dawnDrop = new Event.VerzikDawnDrop();
    dawnDrop.setDropped(json.verzikDawnDrop.dropped);
    event.setVerzikDawnDrop(dawnDrop);
  }

  // Colosseum events
  if (json.handicap !== undefined) {
    event.setHandicap(json.handicap as AnyEnum);
  }

  if (json.handicapOptions !== undefined) {
    event.setHandicapOptionsList(json.handicapOptions as AnyEnum[]);
  }

  if (json.colosseumTotemHeal !== undefined) {
    const heal = new Event.ColosseumTotemHeal();
    heal.setSource(npcJsonToProto(json.colosseumTotemHeal.source));
    heal.setTarget(npcJsonToProto(json.colosseumTotemHeal.target));
    heal.setStartTick(json.colosseumTotemHeal.startTick);
    heal.setHealAmount(json.colosseumTotemHeal.healAmount);
    event.setColosseumTotemHeal(heal);
  }

  if (json.colosseumReentryPools !== undefined) {
    const pools = new Event.ColosseumReentryPools();
    pools.setPrimarySpawnedList(
      json.colosseumReentryPools.primarySpawned.map(coordsJsonToProto),
    );
    pools.setSecondarySpawnedList(
      json.colosseumReentryPools.secondarySpawned.map(coordsJsonToProto),
    );
    pools.setPrimaryDespawnedList(
      json.colosseumReentryPools.primaryDespawned.map(coordsJsonToProto),
    );
    pools.setSecondaryDespawnedList(
      json.colosseumReentryPools.secondaryDespawned.map(coordsJsonToProto),
    );
    event.setColosseumReentryPools(pools);
  }

  if (json.colosseumSolDust !== undefined) {
    const dust = new Event.ColosseumSolDust();
    dust.setPattern(json.colosseumSolDust.pattern as AnyEnum);
    if (json.colosseumSolDust.direction !== undefined) {
      dust.setDirection(json.colosseumSolDust.direction as AnyEnum);
    }
    event.setColosseumSolDust(dust);
  }

  if (json.colosseumSolGrapple !== undefined) {
    const grapple = new Event.ColosseumSolGrapple();
    grapple.setAttackTick(json.colosseumSolGrapple.attackTick);
    grapple.setTarget(json.colosseumSolGrapple.target as AnyEnum);
    grapple.setOutcome(json.colosseumSolGrapple.outcome as AnyEnum);
    event.setColosseumSolGrapple(grapple);
  }

  if (json.colosseumSolPools !== undefined) {
    const pools = new Event.ColosseumSolPools();
    pools.setPoolsList(json.colosseumSolPools.pools.map(coordsJsonToProto));
    event.setColosseumSolPools(pools);
  }

  if (json.colosseumSolLasers !== undefined) {
    const lasers = new Event.ColosseumSolLasers();
    lasers.setPhase(json.colosseumSolLasers.phase as AnyEnum);
    event.setColosseumSolLasers(lasers);
  }

  // Mokhaiotl events
  if (json.mokhaiotlAttackStyle !== undefined) {
    const style = new Event.AttackStyle();
    style.setStyle(json.mokhaiotlAttackStyle.style as AnyEnum);
    style.setNpcAttackTick(json.mokhaiotlAttackStyle.npcAttackTick);
    event.setMokhaiotlAttackStyle(style);
  }

  if (json.mokhaiotlOrb !== undefined) {
    const orb = new Event.MokhaiotlOrb();
    orb.setSource(json.mokhaiotlOrb.source as AnyEnum);
    if (json.mokhaiotlOrb.sourcePoint !== undefined) {
      orb.setSourcePoint(coordsJsonToProto(json.mokhaiotlOrb.sourcePoint));
    }
    orb.setStyle(json.mokhaiotlOrb.style as AnyEnum);
    orb.setStartTick(json.mokhaiotlOrb.startTick);
    orb.setEndTick(json.mokhaiotlOrb.endTick);
    event.setMokhaiotlOrb(orb);
  }

  if (json.mokhaiotlObjects !== undefined) {
    const objects = new Event.MokhaiotlObjects();
    if (json.mokhaiotlObjects.rocksSpawned !== undefined) {
      objects.setRocksSpawnedList(
        json.mokhaiotlObjects.rocksSpawned.map(coordsJsonToProto),
      );
    }
    if (json.mokhaiotlObjects.rocksDespawned !== undefined) {
      objects.setRocksDespawnedList(
        json.mokhaiotlObjects.rocksDespawned.map(coordsJsonToProto),
      );
    }
    if (json.mokhaiotlObjects.splatsSpawned !== undefined) {
      objects.setSplatsSpawnedList(
        json.mokhaiotlObjects.splatsSpawned.map(coordsJsonToProto),
      );
    }
    if (json.mokhaiotlObjects.splatsDespawned !== undefined) {
      objects.setSplatsDespawnedList(
        json.mokhaiotlObjects.splatsDespawned.map(coordsJsonToProto),
      );
    }
    event.setMokhaiotlObjects(objects);
  }

  if (json.mokhaiotlLarvaLeak !== undefined) {
    const leak = new Event.MokhaiotlLarvaLeak();
    leak.setRoomId(json.mokhaiotlLarvaLeak.roomId);
    leak.setHealAmount(json.mokhaiotlLarvaLeak.healAmount);
    event.setMokhaiotlLarvaLeak(leak);
  }

  if (json.mokhaiotlShockwave !== undefined) {
    const wave = new Event.MokhaiotlShockwave();
    wave.setTilesList(json.mokhaiotlShockwave.tiles.map(coordsJsonToProto));
    event.setMokhaiotlShockwave(wave);
  }

  // Inferno events
  if (json.infernoWaveStart !== undefined) {
    const wave = new Event.InfernoWaveStart();
    wave.setWave(json.infernoWaveStart.wave);
    wave.setOverallTicks(json.infernoWaveStart.overallTicks);
    event.setInfernoWaveStart(wave);
  }

  return event;
}

function npcJsonToProto(json: z.infer<typeof npcSchema>): Event.Npc {
  const npc = new Event.Npc();
  // Normalize RuneLite's -1 NPC IDs to 0 as proto stores them unsigned.
  npc.setId(json.id < 0 ? 0 : json.id);
  npc.setRoomId(json.roomId);
  if (json.hitpoints !== undefined) {
    npc.setHitpoints(json.hitpoints);
  }
  if (json.activePrayers !== undefined) {
    npc.setActivePrayers(json.activePrayers);
  }
  if (json.size !== undefined) {
    npc.setSize(json.size);
  }
  if (json.animation !== undefined) {
    npc.setAnimation(json.animation);
  }
  if (json.target !== undefined) {
    const target = new Event.Npc.Target();
    if ('player' in json.target) {
      target.setPlayer(json.target.player);
    } else {
      target.setNpcRoomId(json.target.npcRoomId);
    }
    npc.setTarget(target);
  }
  if (json.spotAnims !== undefined) {
    npc.setSpotAnimsList(json.spotAnims);
  }
  if (json.overheads !== undefined) {
    npc.setOverheadsList(json.overheads);
  }

  if (json.maidenCrab !== undefined) {
    const crab = new Event.Npc.MaidenCrab();
    crab.setSpawn(json.maidenCrab.spawn as AnyEnum);
    crab.setPosition(json.maidenCrab.position as AnyEnum);
    crab.setScuffed(json.maidenCrab.scuffed);
    npc.setMaidenCrab(crab);
  } else if (json.nylo !== undefined) {
    const nylo = new Event.Npc.Nylo();
    nylo.setWave(json.nylo.wave);
    nylo.setParentRoomId(json.nylo.parentRoomId);
    nylo.setBig(json.nylo.big);
    nylo.setStyle(json.nylo.style as AnyEnum);
    nylo.setSpawnType(json.nylo.spawnType as AnyEnum);
    npc.setNylo(nylo);
  } else if (json.verzikCrab !== undefined) {
    const crab = new Event.Npc.VerzikCrab();
    crab.setPhase(json.verzikCrab.phase as AnyEnum);
    crab.setSpawn(json.verzikCrab.spawn as AnyEnum);
    npc.setVerzikCrab(crab);
  } else {
    npc.setBasic(new Empty());
  }

  return npc;
}

function coordsJsonToProto(json: { x: number; y: number }): Coords {
  const coords = new Coords();
  coords.setX(json.x);
  coords.setY(json.y);
  return coords;
}

function varValueJsonToProto(json: {
  id: number;
  value: number;
}): Event.Vars.Value {
  const value = new Event.Vars.Value();
  value.setId(json.id);
  value.setValue(json.value);
  return value;
}

export function attackDefinitionJsonToProto(
  json: z.infer<typeof attackDefinitionSchema>,
): AttackDefinition {
  const def = new AttackDefinition();
  def.setId(json.protoId as AnyEnum);
  def.setName(json.name);
  def.setWeaponIdsList(json.weaponIds);
  def.setAnimationIdsList(json.animationIds);
  def.setCooldown(json.cooldown);

  if (json.projectile !== undefined) {
    const proj = new AttackDefinition.Projectile();
    proj.setId(json.projectile.id);
    proj.setStartCycleOffset(json.projectile.startCycleOffset);
    if (json.projectile.weaponId !== undefined) {
      proj.setWeaponId(json.projectile.weaponId);
    }
    def.setProjectile(proj);
  }

  if (json.weaponProjectiles !== undefined) {
    const projs = json.weaponProjectiles.map((p) => {
      const proj = new AttackDefinition.Projectile();
      proj.setId(p.id);
      proj.setStartCycleOffset(p.startCycleOffset);
      if (p.weaponId !== undefined) {
        proj.setWeaponId(p.weaponId);
      }
      return proj;
    });
    def.setWeaponProjectilesList(projs);
  }

  def.setContinuousAnimation(json.continuousAnimation ?? false);
  if (json.animationFrameMin !== undefined) {
    def.setAnimationFrameMin(json.animationFrameMin);
  }
  if (json.animationFrameMax !== undefined) {
    def.setAnimationFrameMax(json.animationFrameMax);
  }

  if (json.attackerGraphicIds !== undefined) {
    def.setAttackerGraphicIdsList(json.attackerGraphicIds);
  }

  switch (json.category) {
    case 'MELEE':
      def.setCategory(AttackDefinition.Category.MELEE);
      break;
    case 'RANGED':
      def.setCategory(AttackDefinition.Category.RANGED);
      break;
    case 'MAGIC':
      def.setCategory(AttackDefinition.Category.MAGIC);
      break;
  }

  return def;
}

export function spellDefinitionJsonToProto(
  json: z.infer<typeof spellDefinitionSchema>,
): SpellDefinition {
  const def = new SpellDefinition();
  def.setId(json.id as AnyEnum);
  def.setName(json.name);
  def.setAnimationIdsList(json.animationIds);

  if (json.graphics !== undefined) {
    const graphics = json.graphics.map((g) => {
      const graphic = new SpellDefinition.Graphic();
      graphic.setId(g.id);
      graphic.setDurationTicks(g.durationTicks);
      graphic.setMaxFrame(g.maxFrame);
      return graphic;
    });
    def.setGraphicsList(graphics);
  }

  if (json.targetGraphics !== undefined) {
    const targetGraphics = json.targetGraphics.map((g) => {
      const graphic = new SpellDefinition.Graphic();
      graphic.setId(g.id);
      graphic.setDurationTicks(g.durationTicks);
      graphic.setMaxFrame(g.maxFrame);
      return graphic;
    });
    def.setTargetGraphicsList(targetGraphics);
  }

  def.setStallTicks(json.stallTicks);

  return def;
}

export function recordingConfigJsonToProto(
  json: z.infer<typeof recordingConfigSchema>,
): RecordingConfig {
  const config = new RecordingConfig();
  config.setVersion(json.version);
  if (json.global !== undefined) {
    config.setGlobal(scopeJsonToProto(json.global));
  }
  config.setChallengesList(
    json.challenges.map((c) => {
      const challengeScope = new RecordingConfig.ChallengeScope();
      challengeScope.setChallenge(c.challenge as AnyEnum);
      challengeScope.setScope(scopeJsonToProto(c.scope));
      return challengeScope;
    }),
  );
  return config;
}

function scopeJsonToProto(
  json: z.infer<typeof scopeSchema>,
): RecordingConfig.Scope {
  const scope = new RecordingConfig.Scope();
  scope.setObjectsList(
    (json.objects ?? []).map((o) => {
      const capture = new RecordingConfig.ObjectCapture();
      capture.setType(o.type as AnyEnum);
      capture.setIdsList(o.ids);
      capture.setOnCreation(o.onCreation ?? false);
      return capture;
    }),
  );
  scope.setNpcDefinitionsList(
    (json.npcDefinitions ?? []).map((d) => {
      const definition = new RecordingConfig.NpcDefinition();
      definition.setIdsList(d.ids);
      if (d.mode !== undefined) {
        definition.setMode(d.mode as AnyEnum);
      }
      definition.setHitpointsList(
        (d.hitpoints ?? []).map((hitpoints) => hitpoints ?? 0),
      );
      if (d.hitpointsVarbit !== undefined) {
        const varbit = new RecordingConfig.HitpointsVarbit();
        varbit.setId(d.hitpointsVarbit.id);
        varbit.setScale(d.hitpointsVarbit.scale);
        definition.setHitpointsVarbit(varbit);
      }
      return definition;
    }),
  );
  scope.setVarbitsList(json.varbits ?? []);
  scope.setVarpsList(json.varps ?? []);
  return scope;
}

/**
 * Converts a ServerMessage protobuf to canonical proto3 JSON format.
 * Only fields sent from server to client are included.
 * Client-to-server fields such as events are ignored.
 *
 * @param msg ServerMessage protobuf object.
 * @returns ServerMessage JSON object.
 */
export function serverMessageToJson(msg: ServerMessage): ServerMessageJson {
  // Note: The protobuf toObject() method uses `*List` suffixes for repeated
  // fields (e.g., `recentRecordingsList`), but our JSON wire format omits the
  // suffix. This function transforms the output to match the wire format.
  const json: ServerMessageJson = { type: msg.getType() };

  if (msg.hasUser()) {
    const user = msg.getUser()!;
    json.user = { id: user.getId(), name: user.getName() };
  }

  if (msg.hasError()) {
    const error = msg.getError()!;
    json.error = { type: error.getType(), username: error.getUsername() };
    if (error.hasMessage()) {
      json.error.message = error.getMessage();
    }
  }

  if (msg.hasActiveChallengeId()) {
    json.activeChallengeId = msg.getActiveChallengeId();
  }

  if (msg.getRecentRecordingsList().length > 0) {
    const recentRecordings = msg.getRecentRecordingsList();
    json.recentRecordings = recentRecordings.map(pastChallengeToJson);
  }

  if (msg.hasServerStatus()) {
    const serverStatus = msg.getServerStatus()!;
    json.serverStatus = serverStatus.toObject();
  }

  if (msg.hasGameState()) {
    const gameState = msg.getGameState()!;
    json.gameState = gameState.toObject();
  }

  if (msg.getPlayerStateList().length > 0) {
    const playerStates = msg.getPlayerStateList();
    json.playerState = playerStates.map((p) => ({
      username: p.getUsername(),
      challengeId: p.getChallengeId(),
      challenge: p.getChallenge(),
      mode: p.getMode(),
    }));
  }

  if (msg.hasChallengeStateConfirmation()) {
    const challengeStateConfirmation = msg.getChallengeStateConfirmation()!;
    json.challengeStateConfirmation = {
      isValid: challengeStateConfirmation.getIsValid(),
      username: challengeStateConfirmation.getUsername(),
      challenge: challengeStateConfirmation.getChallenge(),
      mode: challengeStateConfirmation.getMode(),
      stage: challengeStateConfirmation.getStage(),
      party: challengeStateConfirmation.getPartyList(),
      spectator: challengeStateConfirmation.getSpectator(),
    };
  }

  if (msg.getAttackDefinitionsList().length > 0) {
    const attackDefinitions = msg.getAttackDefinitionsList();
    json.attackDefinitions = attackDefinitions.map(attackDefinitionToJson);
  }

  if (msg.getSpellDefinitionsList().length > 0) {
    const spellDefinitions = msg.getSpellDefinitionsList();
    json.spellDefinitions = spellDefinitions.map(spellDefinitionToJson);
  }

  if (msg.hasRecordingConfig()) {
    json.recordingConfig = recordingConfigToJson(msg.getRecordingConfig()!);
  }

  json.requestId = msg.getRequestId();

  return json;
}

function recordingConfigToJson(
  config: RecordingConfig,
): z.infer<typeof recordingConfigSchema> {
  const json: z.infer<typeof recordingConfigSchema> = {
    version: config.getVersion(),
    challenges: config.getChallengesList().map((challengeScope) => ({
      challenge: challengeScope.getChallenge(),
      scope: scopeToJson(challengeScope.getScope()!),
    })),
  };
  if (config.hasGlobal()) {
    json.global = scopeToJson(config.getGlobal()!);
  }
  return json;
}

function scopeToJson(
  scope: RecordingConfig.Scope,
): z.infer<typeof scopeSchema> {
  const json: z.infer<typeof scopeSchema> = {
    objects: scope.getObjectsList().map((capture) => {
      const json: z.infer<typeof objectCaptureSchema> = {
        type: capture.getType(),
        ids: capture.getIdsList(),
      };
      if (capture.getOnCreation()) {
        json.onCreation = true;
      }
      return json;
    }),
  };
  if (scope.getNpcDefinitionsList().length > 0) {
    json.npcDefinitions = scope.getNpcDefinitionsList().map((definition) => {
      const json: z.infer<typeof npcDefinitionSchema> = {
        ids: definition.getIdsList(),
        hitpoints: definition
          .getHitpointsList()
          .map((hitpoints) => (hitpoints === 0 ? null : hitpoints)),
      };
      if (definition.getMode() !== ChallengeMode.NO_MODE) {
        json.mode = definition.getMode();
      }
      if (definition.hasHitpointsVarbit()) {
        const varbit = definition.getHitpointsVarbit()!;
        json.hitpointsVarbit = { id: varbit.getId(), scale: varbit.getScale() };
      }
      return json;
    });
  }
  if (scope.getVarbitsList().length > 0) {
    json.varbits = scope.getVarbitsList();
  }
  if (scope.getVarpsList().length > 0) {
    json.varps = scope.getVarpsList();
  }
  return json;
}

function pastChallengeToJson(
  pastChallenge: ServerMessage.PastChallenge,
): z.infer<typeof pastChallengeSchema> {
  const json: z.infer<typeof pastChallengeSchema> = {
    id: pastChallenge.getId(),
    status: pastChallenge.getStatus(),
    stage: pastChallenge.getStage(),
    mode: pastChallenge.getMode(),
    party: pastChallenge.getPartyList(),
    challenge: pastChallenge.getChallenge(),
    challengeTicks: pastChallenge.getChallengeTicks(),
  };
  if (pastChallenge.hasTimestamp()) {
    const timestamp = pastChallenge.getTimestamp()!;
    json.timestamp = {
      seconds: timestamp.getSeconds(),
      nanos: timestamp.getNanos(),
    };
  }
  return json;
}

function attackDefinitionToJson(
  attackDefinition: AttackDefinition,
): z.infer<typeof attackDefinitionSchema> {
  const json: z.infer<typeof attackDefinitionSchema> = {
    protoId: attackDefinition.getId(),
    name: attackDefinition.getName(),
    weaponIds: attackDefinition.getWeaponIdsList(),
    animationIds: attackDefinition.getAnimationIdsList(),
    cooldown: attackDefinition.getCooldown(),
    continuousAnimation: attackDefinition.getContinuousAnimation(),
    category: categoryEnumToString(attackDefinition.getCategory()),
  };

  if (attackDefinition.hasProjectile()) {
    json.projectile = projectileToJson(attackDefinition.getProjectile()!);
  }

  if (attackDefinition.getWeaponProjectilesList().length > 0) {
    json.weaponProjectiles = attackDefinition
      .getWeaponProjectilesList()
      .map(projectileToJson<WeaponProjectileSchema>);
  }

  if (attackDefinition.hasAnimationFrameMin()) {
    json.animationFrameMin = attackDefinition.getAnimationFrameMin();
  }
  if (attackDefinition.hasAnimationFrameMax()) {
    json.animationFrameMax = attackDefinition.getAnimationFrameMax();
  }

  if (attackDefinition.getAttackerGraphicIdsList().length > 0) {
    json.attackerGraphicIds = attackDefinition.getAttackerGraphicIdsList();
  }

  return json;
}

type ProjectileSchema = z.infer<typeof projectileSchema>;
type WeaponProjectileSchema = z.infer<typeof weaponProjectileSchema>;

function projectileToJson<
  T extends ProjectileSchema | WeaponProjectileSchema = ProjectileSchema,
>(weaponProjectile: AttackDefinition.Projectile): T {
  const json: ProjectileSchema | WeaponProjectileSchema = {
    id: weaponProjectile.getId(),
    startCycleOffset: weaponProjectile.getStartCycleOffset(),
  };
  if (weaponProjectile.hasWeaponId()) {
    json.weaponId = weaponProjectile.getWeaponId();
  }
  return json as T;
}

function categoryEnumToString(
  category: AttackDefinition.CategoryMap[keyof AttackDefinition.CategoryMap],
): 'MELEE' | 'RANGED' | 'MAGIC' {
  switch (category) {
    case AttackDefinition.Category.MELEE:
      return 'MELEE';
    case AttackDefinition.Category.RANGED:
      return 'RANGED';
    case AttackDefinition.Category.MAGIC:
      return 'MAGIC';
    default:
      return 'MELEE';
  }
}

function spellDefinitionToJson(
  spellDefinition: SpellDefinition,
): z.infer<typeof spellDefinitionSchema> {
  return {
    id: spellDefinition.getId(),
    name: spellDefinition.getName(),
    animationIds: spellDefinition.getAnimationIdsList(),
    graphics: spellDefinition.getGraphicsList().map((g) => g.toObject()),
    targetGraphics: spellDefinition
      .getTargetGraphicsList()
      .map((g) => g.toObject()),
    stallTicks: spellDefinition.getStallTicks(),
  };
}
