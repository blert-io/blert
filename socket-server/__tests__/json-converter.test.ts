import { Event } from '@blert/common/generated/event_pb';
import {
  AttackDefinition,
  ServerMessage,
} from '@blert/common/generated/server_message_pb';
import { Timestamp } from 'google-protobuf/google/protobuf/timestamp_pb';
import { z } from 'zod';

import {
  jsonToServerMessage,
  serverMessageToJson,
} from '../protocol/json-converter';
import { ServerMessageJson } from '../protocol/json-schemas';

describe('jsonToServerMessage', () => {
  describe('basic message types', () => {
    it('converts a PING message', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.PING,
      };

      const proto = jsonToServerMessage(json);

      expect(proto.getType()).toBe(ServerMessage.Type.PING);
    });

    it('converts a PONG message', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.PONG,
      };

      const proto = jsonToServerMessage(json);

      expect(proto.getType()).toBe(ServerMessage.Type.PONG);
    });

    it('converts a message with user info', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.CONNECTION_RESPONSE,
        user: {
          id: 123,
          name: 'TestUser',
        },
      };

      const proto = jsonToServerMessage(json);

      expect(proto.getType()).toBe(ServerMessage.Type.CONNECTION_RESPONSE);
      expect(proto.getUser()?.getId()).toBe(123);
      expect(proto.getUser()?.getName()).toBe('TestUser');
    });

    it('converts a message with error', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.ERROR,
        error: {
          type: ServerMessage.Error.Type.UNAUTHENTICATED,
          username: 'TestUser',
          message: 'Invalid token',
        },
      };

      const proto = jsonToServerMessage(json);

      expect(proto.getType()).toBe(ServerMessage.Type.ERROR);
      expect(proto.getError()?.getType()).toBe(
        ServerMessage.Error.Type.UNAUTHENTICATED,
      );
      expect(proto.getError()?.getUsername()).toBe('TestUser');
      expect(proto.getError()?.getMessage()).toBe('Invalid token');
    });

    it('converts a message with requestId', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.HISTORY_RESPONSE,
        requestId: 42,
      };

      const proto = jsonToServerMessage(json);

      expect(proto.getRequestId()).toBe(42);
    });
  });

  describe('event conversion', () => {
    it('converts a PLAYER_UPDATE event', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.PLAYER_UPDATE,
            stage: 12,
            tick: 100,
            xCoord: 3290,
            yCoord: 4248,
            player: {
              name: 'TestPlayer',
              offCooldownTick: 105,
              hitpoints: 200674294,
              prayer: 77,
              attack: 99,
              strength: 99,
              defence: 99,
              ranged: 99,
              magic: 99,
              equipmentDeltas: [1234, 5678],
              activePrayers: 262144,
              dataSource: 1,
              partyIndex: 0,
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const events = proto.getChallengeEventsList();

      expect(events).toHaveLength(1);
      expect(events[0].getType()).toBe(Event.Type.PLAYER_UPDATE);
      expect(events[0].getStage()).toBe(12);
      expect(events[0].getTick()).toBe(100);
      expect(events[0].getXCoord()).toBe(3290);
      expect(events[0].getYCoord()).toBe(4248);

      const player = events[0].getPlayer();
      expect(player?.getName()).toBe('TestPlayer');
      expect(player?.getHitpoints()).toBe(200674294);
      expect(player?.getActivePrayers()).toBe(262144);
      expect(player?.getEquipmentDeltasList()).toEqual([1234, 5678]);
    });

    it('converts an NPC_SPAWN event with basic NPC', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.NPC_SPAWN,
            stage: 12,
            tick: 28,
            xCoord: 3292,
            yCoord: 4244,
            npc: {
              id: 10792,
              roomId: 59422,
              hitpoints: 589833,
              activePrayers: 0,
              basic: {},
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const events = proto.getChallengeEventsList();
      const npc = events[0].getNpc();

      expect(npc?.getId()).toBe(10792);
      expect(npc?.getRoomId()).toBe(59422);
      expect(npc?.getHitpoints()).toBe(589833);
      expect(npc?.hasBasic()).toBe(true);
      expect(npc?.hasNylo()).toBe(false);
    });

    it('converts an NPC_SPAWN event with nylo data', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.NPC_SPAWN,
            stage: 12,
            tick: 28,
            xCoord: 3298,
            yCoord: 4243,
            npc: {
              id: 10794,
              roomId: 59240,
              nylo: {
                wave: 1,
                parentRoomId: 0,
                big: true,
                style: 0,
                spawnType: 2,
              },
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const npc = proto.getChallengeEventsList()[0].getNpc();

      expect(npc?.hasNylo()).toBe(true);
      expect(npc?.getNylo()?.getWave()).toBe(1);
      expect(npc?.getNylo()?.getBig()).toBe(true);
      expect(npc?.getNylo()?.getSpawnType()).toBe(2);
    });

    it('converts a PLAYER_ATTACK event with target', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.PLAYER_ATTACK,
            stage: 12,
            tick: 28,
            xCoord: 3297,
            yCoord: 4248,
            player: { name: 'TestPlayer' },
            playerAttack: {
              type: 12,
              weapon: {
                slot: 4,
                id: 28688,
                quantity: 1,
              },
              target: {
                id: 10792,
                roomId: 59422,
                basic: {},
              },
              distanceToTarget: 5,
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const event = proto.getChallengeEventsList()[0];
      expect(event.getPlayer()?.getName()).toBe('TestPlayer');

      const attack = event.getPlayerAttack();
      expect(attack?.getType()).toBe(12);
      expect(attack?.getDistanceToTarget()).toBe(5);
      expect(attack?.getWeapon()?.getId()).toBe(28688);
      expect(attack?.getTarget()?.getId()).toBe(10792);
    });
  });

  describe('attack definitions', () => {
    it('converts attack definitions with category', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.ATTACK_DEFINITIONS,
        attackDefinitions: [
          {
            protoId: 1,
            name: 'Test Attack',
            weaponIds: [1234, 5678],
            animationIds: [100, 101],
            cooldown: 4,
            category: 'MELEE',
          },
          {
            protoId: 2,
            name: 'Ranged Attack',
            weaponIds: [2000],
            animationIds: [200],
            cooldown: 5,
            category: 'RANGED',
            projectile: {
              id: 500,
              startCycleOffset: 30,
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const defs = proto.getAttackDefinitionsList();

      expect(defs).toHaveLength(2);
      expect(defs[0].getName()).toBe('Test Attack');
      expect(defs[0].getCategory()).toBe(AttackDefinition.Category.MELEE);
      expect(defs[0].getWeaponIdsList()).toEqual([1234, 5678]);

      expect(defs[1].getName()).toBe('Ranged Attack');
      expect(defs[1].getCategory()).toBe(AttackDefinition.Category.RANGED);
      expect(defs[1].getProjectile()?.getId()).toBe(500);
    });
  });

  describe('spell definitions', () => {
    it('converts spell definitions', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.SPELL_DEFINITIONS,
        spellDefinitions: [
          {
            id: 10,
            name: 'Ice Barrage',
            animationIds: [1979],
            graphics: [
              {
                id: 369,
                durationTicks: 2,
                maxFrame: 96,
              },
            ],
            stallTicks: 5,
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const defs = proto.getSpellDefinitionsList();

      expect(defs).toHaveLength(1);
      expect(defs[0].getName()).toBe('Ice Barrage');
      expect(defs[0].getAnimationIdsList()).toEqual([1979]);
      expect(defs[0].getGraphicsList()[0].getId()).toBe(369);
    });
  });

  describe('ToB-specific events', () => {
    it('converts maiden blood splats', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.TOB_MAIDEN_BLOOD_SPLATS,
            stage: 10,
            tick: 50,
            xCoord: 0,
            yCoord: 0,
            maidenBloodSplats: [
              { x: 3160, y: 4435 },
              { x: 3161, y: 4436 },
            ],
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const splats = proto
        .getChallengeEventsList()[0]
        .getMaidenBloodSplatsList();

      expect(splats).toHaveLength(2);
      expect(splats[0].getX()).toBe(3160);
      expect(splats[0].getY()).toBe(4435);
    });

    it('converts bloat down event', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.TOB_BLOAT_DOWN,
            stage: 11,
            tick: 33,
            xCoord: 0,
            yCoord: 0,
            bloatDown: {
              downNumber: 1,
              walkTime: 32,
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const down = proto.getChallengeEventsList()[0].getBloatDown();

      expect(down?.getDownNumber()).toBe(1);
      expect(down?.getWalkTime()).toBe(32);
    });

    it('converts nylo wave spawn event', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.TOB_NYLO_WAVE_SPAWN,
            stage: 12,
            tick: 1,
            xCoord: 0,
            yCoord: 0,
            nyloWave: {
              wave: 1,
              nylosAlive: 0,
              roomCap: 12,
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const wave = proto.getChallengeEventsList()[0].getNyloWave();

      expect(wave?.getWave()).toBe(1);
      expect(wave?.getRoomCap()).toBe(12);
    });

    it('converts xarpus phase event', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.TOB_XARPUS_PHASE,
            stage: 14,
            tick: 100,
            xCoord: 0,
            yCoord: 0,
            xarpusPhase: 2,
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      expect(proto.getChallengeEventsList()[0].getXarpusPhase()).toBe(2);
    });

    it('converts verzik phase event', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.TOB_VERZIK_PHASE,
            stage: 15,
            tick: 50,
            xCoord: 0,
            yCoord: 0,
            verzikPhase: 1,
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      expect(proto.getChallengeEventsList()[0].getVerzikPhase()).toBe(1);
    });
  });

  describe('challenge lifecycle messages', () => {
    it('converts challenge start request', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.CHALLENGE_START_REQUEST,
        challengeStartRequest: {
          challenge: 1,
          mode: 11,
          stage: 10,
          party: ['Player1', 'Player2'],
          spectator: false,
        },
      };

      const proto = jsonToServerMessage(json);
      const req = proto.getChallengeStartRequest();

      expect(req?.getChallenge()).toBe(1);
      expect(req?.getMode()).toBe(11);
      expect(req?.getPartyList()).toEqual(['Player1', 'Player2']);
      expect(req?.getSpectator()).toBe(false);
    });

    it('converts challenge end request', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.CHALLENGE_END_REQUEST,
        challengeEndRequest: {
          overallTimeTicks: 1000,
          challengeTimeTicks: 800,
          soft: true,
        },
      };

      const proto = jsonToServerMessage(json);
      const req = proto.getChallengeEndRequest();

      expect(req?.getOverallTimeTicks()).toBe(1000);
      expect(req?.getChallengeTimeTicks()).toBe(800);
      expect(req?.getSoft()).toBe(true);
    });

    it('converts challenge update', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.CHALLENGE_UPDATE,
        challengeUpdate: {
          mode: 11,
          party: ['Player1', 'Player2', 'Player3'],
          stageUpdate: {
            stage: 11,
            status: 2,
            accurate: true,
            recordedTicks: 100,
            gameServerTicks: 100,
            gameTicksPrecise: true,
          },
        },
      };

      const proto = jsonToServerMessage(json);
      const update = proto.getChallengeUpdate();

      expect(update?.getMode()).toBe(11);
      expect(update?.getPartyList()).toEqual(['Player1', 'Player2', 'Player3']);
      expect(update?.getStageUpdate()?.getStage()).toBe(11);
      expect(update?.getStageUpdate()?.getAccurate()).toBe(true);
    });
  });

  describe('game state', () => {
    it('converts game state with player info', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.GAME_STATE,
        gameState: {
          state: 2,
          playerInfo: {
            username: 'TestPlayer',
            overallExperience: 100000000,
            attackExperience: 13034431,
            strengthExperience: 13034431,
            defenceExperience: 13034431,
            hitpointsExperience: 13034431,
            rangedExperience: 13034431,
            prayerExperience: 13034431,
            magicExperience: 13034431,
            accountHash: '12345678',
          },
        },
      };

      const proto = jsonToServerMessage(json);
      const state = proto.getGameState();

      expect(state?.getState()).toBe(2);
      expect(state?.getPlayerInfo()?.getUsername()).toBe('TestPlayer');
      expect(state?.getPlayerInfo()?.getOverallExperience()).toBe(100000000);
    });
  });

  describe('player spell events', () => {
    it('converts spell with player target', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.PLAYER_SPELL,
            stage: 15,
            tick: 100,
            xCoord: 3290,
            yCoord: 4248,
            playerSpell: {
              type: 31,
              targetPlayer: 'OtherPlayer',
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const spell = proto.getChallengeEventsList()[0].getPlayerSpell();

      expect(spell?.getType()).toBe(31);
      expect(spell?.getTargetPlayer()).toBe('OtherPlayer');
    });

    it('converts spell with NPC target', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.PLAYER_SPELL,
            stage: 15,
            tick: 100,
            xCoord: 3290,
            yCoord: 4248,
            playerSpell: {
              type: 31,
              targetNpc: {
                id: 10847,
                roomId: 12345,
                basic: {},
              },
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const spell = proto.getChallengeEventsList()[0].getPlayerSpell();

      expect(spell?.getType()).toBe(31);
      expect(spell?.getTargetNpc()?.getId()).toBe(10847);
    });

    it('converts spell with no target', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.PLAYER_SPELL,
            stage: 15,
            tick: 100,
            xCoord: 3290,
            yCoord: 4248,
            playerSpell: { type: 10 },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const spell = proto.getChallengeEventsList()[0].getPlayerSpell();

      expect(spell?.getType()).toBe(10);
      expect(spell?.hasNoTarget()).toBe(true);
    });
  });

  describe('colosseum events', () => {
    it('converts handicap selection', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.COLOSSEUM_HANDICAP_CHOICE,
            stage: 30,
            tick: 1,
            xCoord: 0,
            yCoord: 0,
            handicap: 5,
            handicapOptions: [3, 5, 7],
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const event = proto.getChallengeEventsList()[0];

      expect(event.getHandicap()).toBe(5);
      expect(event.getHandicapOptionsList()).toEqual([3, 5, 7]);
    });
  });

  describe('NPC variants', () => {
    it('converts maiden crab', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.NPC_SPAWN,
            stage: 10,
            tick: 20,
            xCoord: 3160,
            yCoord: 4440,
            npc: {
              id: 8366,
              roomId: 1234,
              maidenCrab: {
                spawn: 1,
                position: 2,
                scuffed: true,
              },
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const npc = proto.getChallengeEventsList()[0].getNpc();

      expect(npc?.hasMaidenCrab()).toBe(true);
      expect(npc?.getMaidenCrab()?.getSpawn()).toBe(1);
      expect(npc?.getMaidenCrab()?.getScuffed()).toBe(true);
    });

    it('converts verzik crab', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.NPC_SPAWN,
            stage: 15,
            tick: 100,
            xCoord: 3160,
            yCoord: 4300,
            npc: {
              id: 8370,
              roomId: 5678,
              verzikCrab: {
                phase: 2,
                spawn: 1,
              },
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const npc = proto.getChallengeEventsList()[0].getNpc();

      expect(npc?.hasVerzikCrab()).toBe(true);
      expect(npc?.getVerzikCrab()?.getPhase()).toBe(2);
    });
  });

  describe('additional message types', () => {
    it('converts activeChallengeId', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.CONNECTION_RESPONSE,
        activeChallengeId: 'test-challenge-uuid',
      };

      const proto = jsonToServerMessage(json);

      expect(proto.getActiveChallengeId()).toBe('test-challenge-uuid');
    });

    it('converts server status', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.SERVER_STATUS,
        serverStatus: {
          status: 1,
          shutdownTime: {
            seconds: 1700000000,
            nanos: 0,
          },
        },
      };

      const proto = jsonToServerMessage(json);
      const status = proto.getServerStatus();

      expect(status?.getStatus()).toBe(1);
      expect(status?.getShutdownTime()?.getSeconds()).toBe(1700000000);
    });

    it('converts player state list', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.PLAYER_STATE,
        playerState: [
          {
            username: 'Player1',
            challengeId: 'challenge-1',
            challenge: 1,
            mode: 11,
          },
          {
            username: 'Player2',
            challengeId: 'challenge-1',
            challenge: 1,
            mode: 11,
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const states = proto.getPlayerStateList();

      expect(states).toHaveLength(2);
      expect(states[0].getUsername()).toBe('Player1');
      expect(states[1].getUsername()).toBe('Player2');
    });

    it('converts challenge state confirmation', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.CHALLENGE_STATE_CONFIRMATION,
        challengeStateConfirmation: {
          isValid: true,
          username: 'TestPlayer',
          challenge: 1,
          mode: 11,
          stage: 12,
          party: ['Player1', 'Player2'],
          spectator: false,
        },
      };

      const proto = jsonToServerMessage(json);
      const conf = proto.getChallengeStateConfirmation();

      expect(conf?.getIsValid()).toBe(true);
      expect(conf?.getUsername()).toBe('TestPlayer');
      expect(conf?.getPartyList()).toEqual(['Player1', 'Player2']);
    });

    it('converts recent recordings from JSON', () => {
      const json: ServerMessageJson = {
        type: ServerMessage.Type.HISTORY_RESPONSE,
        recentRecordings: [
          {
            id: 'uuid-1',
            status: 2,
            stage: 15,
            mode: 11,
            party: ['Player1', 'Player2'],
            challenge: 1,
            challengeTicks: 1200,
            timestamp: {
              seconds: 1768890941,
              nanos: 123456789,
            },
          },
        ],
      };

      const proto = jsonToServerMessage(json);
      const recordings = proto.getRecentRecordingsList();

      expect(recordings).toHaveLength(1);
      expect(recordings[0].getId()).toBe('uuid-1');
      expect(recordings[0].getPartyList()).toEqual(['Player1', 'Player2']);
      expect(recordings[0].getChallengeTicks()).toBe(1200);
      expect(recordings[0].getTimestamp()?.getSeconds()).toBe(1768890941);
      expect(recordings[0].getTimestamp()?.getNanos()).toBe(123456789);
    });
  });

  describe('validation errors', () => {
    it('throws on invalid message type', () => {
      const json = {
        type: 'invalid',
      };

      expect(() => jsonToServerMessage(json)).toThrow(z.ZodError);
    });

    it('throws on negative NPC id', () => {
      const json = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.NPC_SPAWN,
            stage: 12,
            tick: 28,
            xCoord: 0,
            yCoord: 0,
            npc: {
              id: -1,
              roomId: 100,
            },
          },
        ],
      };

      expect(() => jsonToServerMessage(json)).toThrow(z.ZodError);
    });

    it('throws on missing required fields', () => {
      const json = {
        type: ServerMessage.Type.EVENT_STREAM,
        challengeEvents: [
          {
            type: Event.Type.PLAYER_UPDATE,
            // missing required fields
          },
        ],
      };

      expect(() => jsonToServerMessage(json)).toThrow(z.ZodError);
    });
  });
});

describe('serverMessageToJson', () => {
  it('converts a simple message to JSON', () => {
    const proto = new ServerMessage();
    proto.setType(ServerMessage.Type.PING);

    const json = serverMessageToJson(proto);

    expect(json.type).toBe(ServerMessage.Type.PING);
  });

  it('converts user info to JSON', () => {
    const proto = new ServerMessage();
    proto.setType(ServerMessage.Type.CONNECTION_RESPONSE);
    const user = new ServerMessage.User();
    user.setId(123);
    user.setName('TestUser');
    proto.setUser(user);

    const json = serverMessageToJson(proto);

    expect(json.user?.id).toBe(123);
    expect(json.user?.name).toBe('TestUser');
  });

  it('converts attack definitions with category strings', () => {
    const proto = new ServerMessage();
    proto.setType(ServerMessage.Type.ATTACK_DEFINITIONS);

    const def = new AttackDefinition();
    def.setId(1);
    def.setName('Test Attack');
    def.setCategory(AttackDefinition.Category.MAGIC);
    def.setWeaponIdsList([100]);
    def.setAnimationIdsList([200]);
    def.setCooldown(5);
    proto.setAttackDefinitionsList([def]);

    const json = serverMessageToJson(proto);

    expect(json.attackDefinitions).toHaveLength(1);
    expect(json.attackDefinitions![0].protoId).toBe(1);
    expect(json.attackDefinitions![0].category).toBe('MAGIC');
  });

  it('removes List suffix from repeated fields', () => {
    const proto = new ServerMessage();
    proto.setType(ServerMessage.Type.HISTORY_RESPONSE);

    const recording = new ServerMessage.PastChallenge();
    recording.setId('test-uuid');
    recording.setStatus(1);
    recording.setStage(12);
    recording.setMode(11);
    recording.setChallenge(1);
    recording.setPartyList(['Player1', 'Player2']);
    recording.setChallengeTicks(1200);
    const timestamp = new Timestamp();
    timestamp.setSeconds(1768890941);
    timestamp.setNanos(123456789);
    recording.setTimestamp(timestamp);
    proto.setRecentRecordingsList([recording]);

    const json = serverMessageToJson(proto);

    // Fields should be named `recentRecordings` and `party`.
    expect(json.recentRecordings).toBeDefined();
    expect(json.recentRecordings).toHaveLength(1);
    expect(json.recentRecordings![0].id).toBe('test-uuid');
    expect(json.recentRecordings![0].party).toEqual(['Player1', 'Player2']);
    expect(json.recentRecordings![0].challengeTicks).toBe(1200);
    expect(json.recentRecordings![0].timestamp?.seconds).toBe(1768890941);
    expect(json.recentRecordings![0].timestamp?.nanos).toBe(123456789);
  });

  it('does not include client-to-server fields like challengeEvents', () => {
    // serverMessageToJson only converts server-to-client fields.
    // Client-to-server fields like challengeEvents are not included
    // because they're never sent from server to client.
    const proto = new ServerMessage();
    proto.setType(ServerMessage.Type.EVENT_STREAM);

    const event = new Event();
    event.setType(Event.Type.PLAYER_UPDATE);
    proto.setChallengeEventsList([event]);

    const json = serverMessageToJson(proto);

    expect(json.challengeEvents).toBeUndefined();
  });
});

describe('round-trip conversion', () => {
  it('preserves attack definitions through JSON -> Proto -> JSON', () => {
    const originalJson: ServerMessageJson = {
      type: ServerMessage.Type.ATTACK_DEFINITIONS,
      attackDefinitions: [
        {
          protoId: 42,
          name: 'Dragon Claws',
          weaponIds: [13652],
          animationIds: [7514],
          cooldown: 4,
          category: 'MELEE',
        },
        {
          protoId: 100,
          name: 'Twisted Bow',
          weaponIds: [20997],
          animationIds: [426],
          cooldown: 5,
          category: 'RANGED',
          projectile: {
            id: 1120,
            startCycleOffset: 41,
          },
        },
      ],
      requestId: 1,
    };

    const proto = jsonToServerMessage(originalJson);
    const resultJson = serverMessageToJson(proto);

    expect(resultJson.type).toBe(originalJson.type);
    expect(resultJson.requestId).toBe(originalJson.requestId);
    expect(resultJson.attackDefinitions).toHaveLength(2);

    const originalDef = originalJson.attackDefinitions![0];
    const resultDef = resultJson.attackDefinitions![0];

    expect(resultDef.protoId).toBe(originalDef.protoId);
    expect(resultDef.name).toBe(originalDef.name);
    expect(resultDef.weaponIds).toEqual(originalDef.weaponIds);
    expect(resultDef.category).toBe(originalDef.category);

    // Check projectile on second definition
    expect(resultJson.attackDefinitions![1].projectile?.id).toBe(1120);
  });

  it('preserves spell definitions through JSON -> Proto -> JSON', () => {
    const originalJson: ServerMessageJson = {
      type: ServerMessage.Type.SPELL_DEFINITIONS,
      spellDefinitions: [
        {
          id: 31,
          name: 'Ice Barrage',
          animationIds: [1979],
          graphics: [{ id: 369, durationTicks: 2, maxFrame: 96 }],
          stallTicks: 5,
        },
      ],
    };

    const proto = jsonToServerMessage(originalJson);
    const resultJson = serverMessageToJson(proto);

    expect(resultJson.spellDefinitions).toHaveLength(1);
    expect(resultJson.spellDefinitions![0].name).toBe('Ice Barrage');
    expect(resultJson.spellDefinitions![0].graphics).toHaveLength(1);
  });
});
