/**
 * Conversion functions between JSON and Protobuf message formats.
 */
import { Coords, Event } from '@blert/common/generated/event_pb';
import {
  AttackDefinition,
  ChallengeEndRequest,
  ChallengeStartRequest,
  ChallengeUpdate,
  ServerMessage,
  SpellDefinition,
} from '@blert/common/generated/server_message_pb';
import { Empty } from 'google-protobuf/google/protobuf/empty_pb';
import { Timestamp } from 'google-protobuf/google/protobuf/timestamp_pb';
import { z } from 'zod';

import {
  attackDefinitionSchema,
  EventJson,
  npcSchema,
  pastChallengeSchema,
  ServerMessageJson,
  serverMessageSchema,
  spellDefinitionSchema,
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
    const events = json.challengeEvents.map(eventJsonToProto);
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

  if (json.requestId !== undefined) {
    msg.setRequestId(json.requestId);
  }

  return msg;
}

function eventJsonToProto(json: EventJson): Event {
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

  // ToB events
  if (json.maidenBloodSplats !== undefined) {
    event.setMaidenBloodSplatsList(
      json.maidenBloodSplats.map(coordsJsonToProto),
    );
  }

  if (json.bloatDown !== undefined) {
    const down = new Event.BloatDown();
    down.setDownNumber(json.bloatDown.downNumber);
    down.setWalkTime(json.bloatDown.walkTime);
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

  // Colosseum events
  if (json.handicap !== undefined) {
    event.setHandicap(json.handicap as AnyEnum);
  }

  if (json.handicapOptions !== undefined) {
    event.setHandicapOptionsList(json.handicapOptions as AnyEnum[]);
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
  npc.setId(json.id);
  npc.setRoomId(json.roomId);
  if (json.hitpoints !== undefined) {
    npc.setHitpoints(json.hitpoints);
  }
  if (json.activePrayers !== undefined) {
    npc.setActivePrayers(json.activePrayers);
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

function attackDefinitionJsonToProto(
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

function spellDefinitionJsonToProto(
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
  const obj = msg.toObject();

  const json: ServerMessageJson = { type: obj.type };

  if (obj.user !== undefined) {
    json.user = { id: obj.user.id, name: obj.user.name };
  }

  if (obj.error !== undefined) {
    json.error = { type: obj.error.type, username: obj.error.username };
    if (obj.error.message !== undefined) {
      json.error.message = obj.error.message;
    }
  }

  if (obj.activeChallengeId !== undefined) {
    json.activeChallengeId = obj.activeChallengeId;
  }

  if (obj.recentRecordingsList !== undefined) {
    json.recentRecordings = obj.recentRecordingsList.map(pastChallengeToJson);
  }

  if (obj.serverStatus !== undefined) {
    json.serverStatus = obj.serverStatus;
  }

  if (obj.gameState !== undefined) {
    json.gameState = obj.gameState;
  }

  if (obj.playerStateList !== undefined) {
    json.playerState = obj.playerStateList;
  }

  if (obj.challengeStateConfirmation !== undefined) {
    json.challengeStateConfirmation = {
      isValid: obj.challengeStateConfirmation.isValid,
      username: obj.challengeStateConfirmation.username,
      challenge: obj.challengeStateConfirmation.challenge,
      mode: obj.challengeStateConfirmation.mode,
      stage: obj.challengeStateConfirmation.stage,
      party: obj.challengeStateConfirmation.partyList,
      spectator: obj.challengeStateConfirmation.spectator,
    };
  }

  if (obj.attackDefinitionsList !== undefined) {
    json.attackDefinitions = obj.attackDefinitionsList.map(
      attackDefinitionToJson,
    );
  }

  if (obj.spellDefinitionsList !== undefined) {
    json.spellDefinitions = obj.spellDefinitionsList.map(spellDefinitionToJson);
  }

  if (obj.requestId !== undefined) {
    json.requestId = obj.requestId;
  }

  return json;
}

function pastChallengeToJson(
  obj: ServerMessage.PastChallenge.AsObject,
): z.infer<typeof pastChallengeSchema> {
  const json: z.infer<typeof pastChallengeSchema> = {
    id: obj.id,
    status: obj.status,
    stage: obj.stage,
    mode: obj.mode,
    party: obj.partyList,
    challenge: obj.challenge,
    challengeTicks: obj.challengeTicks,
  };
  if (obj.timestamp !== undefined) {
    json.timestamp = {
      seconds: obj.timestamp.seconds,
      nanos: obj.timestamp.nanos,
    };
  }
  return json;
}

function attackDefinitionToJson(
  obj: AttackDefinition.AsObject,
): z.infer<typeof attackDefinitionSchema> {
  return {
    protoId: obj.id,
    name: obj.name,
    weaponIds: obj.weaponIdsList,
    animationIds: obj.animationIdsList,
    cooldown: obj.cooldown,
    projectile: obj.projectile,
    weaponProjectiles: obj.weaponProjectilesList,
    continuousAnimation: obj.continuousAnimation,
    category: categoryEnumToString(obj.category),
  };
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
  obj: SpellDefinition.AsObject,
): z.infer<typeof spellDefinitionSchema> {
  return {
    id: obj.id,
    name: obj.name,
    animationIds: obj.animationIdsList,
    graphics: obj.graphicsList,
    targetGraphics: obj.targetGraphicsList,
    stallTicks: obj.stallTicks,
  };
}
