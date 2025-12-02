import {
  ChallengeType,
  DataSource,
  EventType,
  ItemDelta,
  NpcAttack,
  Stage,
  StageStatus,
  StageStreamEvents,
  StageStreamType,
} from '@blert/common';
import { ChallengeEvents } from '@blert/common/generated/challenge_storage_pb';
import {
  NpcAttackMap,
  Event as ProtoEvent,
  StageMap,
} from '@blert/common/generated/event_pb';

import { ClientEvents, ClientAnomaly } from '../client-events';
import { createPlayerUpdateEvent, createNpcSpawnEvent } from './fixtures';
import { ChallengeInfo } from '../merge';

type ProtoEventType = ProtoEvent.TypeMap[keyof ProtoEvent.TypeMap];
type ProtoStage = StageMap[keyof StageMap];
type ProtoNpcAttack = NpcAttackMap[keyof NpcAttackMap];

function createVerzikBounceEvent({
  tick,
  npcAttackTick,
  bouncedPlayer,
}: {
  tick: number;
  npcAttackTick: number;
  bouncedPlayer: string;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(EventType.TOB_VERZIK_BOUNCE as ProtoEventType);
  event.setTick(tick);
  event.setStage(Stage.TOB_VERZIK as ProtoStage);

  const bounce = new ProtoEvent.VerzikBounce();
  bounce.setNpcAttackTick(npcAttackTick);
  bounce.setBouncedPlayer(bouncedPlayer);
  event.setVerzikBounce(bounce);

  return event;
}

function createNpcAttackEvent({
  tick,
  attack,
  stage,
}: {
  tick: number;
  attack: NpcAttack;
  stage: Stage;
}): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(EventType.NPC_ATTACK as ProtoEventType);
  event.setTick(tick);
  event.setStage(stage as ProtoStage);

  const npcAttack = new ProtoEvent.NpcAttacked();
  npcAttack.setAttack(attack as ProtoNpcAttack);
  event.setNpcAttack(npcAttack);

  return event;
}

type ProtoDataSource =
  ProtoEvent.Player.DataSourceMap[keyof ProtoEvent.Player.DataSourceMap];

const challengeInfo: ChallengeInfo = {
  uuid: '11111111-2222-3333-4444-555555555555',
  type: ChallengeType.TOB,
  party: ['player1', 'player2'],
};

describe('ClientEvents', () => {
  it('derives recorded ticks when not provided', () => {
    const client = ClientEvents.fromRawEvents(
      1,
      challengeInfo,
      {
        stage: Stage.TOB_MAIDEN,
        status: StageStatus.STARTED,
        accurate: false,
        recordedTicks: 0,
        serverTicks: null,
      },
      [
        createPlayerUpdateEvent({ tick: 0, name: 'player1' }),
        createPlayerUpdateEvent({ tick: 5, name: 'player1' }),
      ],
    );

    expect(client.getStage()).toBe(Stage.TOB_MAIDEN);
    expect(client.getFinalTick()).toBe(5);
    expect(client.isAccurate()).toBe(false);
  });

  describe('anomalies', () => {
    it('treats multiple primary players as a spectator recording', () => {
      const client = ClientEvents.fromRawEvents(
        2,
        challengeInfo,
        {
          stage: Stage.TOB_MAIDEN,
          status: StageStatus.STARTED,
          accurate: false,
          recordedTicks: 1,
          serverTicks: null,
        },
        [
          createPlayerUpdateEvent({
            tick: 0,
            name: 'player1',
            source: DataSource.PRIMARY,
          }),
          createPlayerUpdateEvent({
            tick: 0,
            name: 'player2',
            source: DataSource.PRIMARY,
          }),
        ],
      );

      expect(client.isSpectator()).toBe(true);
      expect(client.hasAnomaly(ClientAnomaly.MULTIPLE_PRIMARY_PLAYERS)).toBe(
        true,
      );
    });

    it('flags clients whose recorded ticks exceed reported server ticks', () => {
      const client = ClientEvents.fromRawEvents(
        3,
        challengeInfo,
        {
          stage: Stage.TOB_MAIDEN,
          status: StageStatus.COMPLETED,
          accurate: true,
          recordedTicks: 5,
          serverTicks: { count: 4, precise: true },
        },
        [
          createPlayerUpdateEvent({ tick: 0, name: 'player1' }),
          createPlayerUpdateEvent({ tick: 4, name: 'player1' }),
        ],
      );

      expect(client.hasInvalidTickCount()).toBe(true);
      expect(client.isAccurate()).toBe(false);
    });

    it('flags missing stage metadata when no stage end update is present', () => {
      const eventsMessage = new ChallengeEvents();
      eventsMessage.setEventsList([
        createPlayerUpdateEvent({ tick: 0, name: 'alice' }),
      ]);
      const stream: StageStreamEvents = {
        type: StageStreamType.STAGE_EVENTS,
        clientId: 6,
        events: eventsMessage.serializeBinary(),
      };

      const client = ClientEvents.fromClientStream(
        6,
        challengeInfo,
        Stage.TOB_MAIDEN,
        [stream],
      );

      expect(client.hasAnomaly(ClientAnomaly.MISSING_STAGE_METADATA)).toBe(
        true,
      );
    });

    describe('movement consistency', () => {
      it('flags invalid movements in stages with no special teleports', () => {
        const stages = [
          Stage.TOB_MAIDEN,
          Stage.INFERNO_WAVE_1,
          Stage.COLOSSEUM_WAVE_2,
          Stage.MOKHAIOTL_DELVE_3,
          Stage.COX_TEKTON,
          Stage.TOA_AKKHA,
          Stage.UNKNOWN,
        ];
        for (const stage of stages) {
          const client = ClientEvents.fromRawEvents(
            4,
            challengeInfo,
            {
              stage,
              status: StageStatus.STARTED,
              accurate: true,
              recordedTicks: 2,
              serverTicks: { count: 2, precise: true },
            },
            [
              createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 0, y: 0 }),
              createPlayerUpdateEvent({
                tick: 1,
                name: 'player1',
                x: 10,
                y: 0,
              }),
            ],
          );
          expect(client.hasConsistencyIssues()).toBe(true);
          expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
            true,
          );
          const issues = client.getConsistencyIssues();
          expect(issues).toHaveLength(1);
          expect(issues[0]).toMatchObject({
            player: 'player1',
            delta: { x: 10, y: 0 },
            ticksSinceLast: 1,
          });
        }
      });

      it('detects inconsistent movement when players skip too many tiles', () => {
        const client = ClientEvents.fromRawEvents(
          4,
          challengeInfo,
          {
            stage: Stage.TOB_MAIDEN,
            status: StageStatus.STARTED,
            accurate: true,
            recordedTicks: 2,
            serverTicks: { count: 2, precise: true },
          },
          [
            createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 0, y: 0 }),
            createPlayerUpdateEvent({ tick: 1, name: 'player1', x: 10, y: 0 }),
          ],
        );

        expect(client.hasConsistencyIssues()).toBe(true);
        expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(true);
        // expect(client.isAccurate()).toBe(false);
        const issues = client.getConsistencyIssues();
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({
          player: 'player1',
          delta: { x: 10, y: 0 },
          ticksSinceLast: 1,
        });
      });

      it('accepts movement within allowable distance', () => {
        const client = ClientEvents.fromRawEvents(
          5,
          challengeInfo,
          {
            stage: Stage.TOB_MAIDEN,
            status: StageStatus.STARTED,
            accurate: true,
            recordedTicks: 2,
            serverTicks: { count: 2, precise: true },
          },
          [
            createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 0, y: 0 }),
            createPlayerUpdateEvent({ tick: 1, name: 'player1', x: 2, y: 1 }),
          ],
        );

        expect(client.hasConsistencyIssues()).toBe(false);
        expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(false);
        expect(client.isAccurate()).toBe(true);
      });

      describe('special teleports', () => {
        describe('death areas', () => {
          it('allows teleport into sotetseg death area', () => {
            const client = ClientEvents.fromRawEvents(
              10,
              challengeInfo,
              {
                stage: Stage.TOB_SOTETSEG,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3274,
                  y: 4321,
                  stage: Stage.TOB_SOTETSEG,
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3270,
                  y: 4314,
                  stage: Stage.TOB_SOTETSEG,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(false);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              false,
            );
            expect(client.isAccurate()).toBe(true);
          });
        });

        describe('Verzik bounce', () => {
          it('allows bounce when player ends 5 tiles from center', () => {
            const client = ClientEvents.fromRawEvents(
              10,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createNpcSpawnEvent({
                  tick: 0,
                  roomId: 1,
                  npcId: 8372,
                  x: 3168,
                  y: 4314,
                  hitpointsCurrent: 1000,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3168,
                  y: 4313,
                  stage: Stage.TOB_VERZIK,
                }),
                createVerzikBounceEvent({
                  tick: 1,
                  npcAttackTick: 0,
                  bouncedPlayer: 'player1',
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3168,
                  y: 4309,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(false);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              false,
            );
            expect(client.isAccurate()).toBe(true);
          });

          it('flags movement when bounce event is missing', () => {
            const client = ClientEvents.fromRawEvents(
              11,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3168,
                  y: 4313,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3168,
                  y: 4309,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
            const issues = client.getConsistencyIssues();
            expect(issues).toHaveLength(1);
            expect(issues[0]).toMatchObject({
              player: 'player1',
              delta: { x: 0, y: -4 },
              ticksSinceLast: 1,
            });
          });

          it('flags movement starting from outside bounceable area', () => {
            const client = ClientEvents.fromRawEvents(
              21,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3168,
                  y: 4305,
                  stage: Stage.TOB_VERZIK,
                }),
                createVerzikBounceEvent({
                  tick: 1,
                  npcAttackTick: 0,
                  bouncedPlayer: 'player1',
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3168,
                  y: 4309,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
          });

          it('flags bounce movement when player does not match', () => {
            const client = ClientEvents.fromRawEvents(
              12,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3168,
                  y: 4313,
                  stage: Stage.TOB_VERZIK,
                }),
                createVerzikBounceEvent({
                  tick: 1,
                  npcAttackTick: 0,
                  bouncedPlayer: 'player2',
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3168,
                  y: 4309,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
          });

          it('only applies to 1-tick movement', () => {
            const client = ClientEvents.fromRawEvents(
              13,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 3,
                serverTicks: { count: 3, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3168,
                  y: 4313,
                  stage: Stage.TOB_VERZIK,
                }),
                createVerzikBounceEvent({
                  tick: 1,
                  npcAttackTick: 0,
                  bouncedPlayer: 'player1',
                }),
                createPlayerUpdateEvent({
                  tick: 2,
                  name: 'player1',
                  x: 3168,
                  y: 4303,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
          });

          describe('fallback when bounce event is missing', () => {
            it('allows bounce with attack event when only one player moved', () => {
              const client = ClientEvents.fromRawEvents(
                24,
                { ...challengeInfo, party: ['player1', 'player2'] },
                {
                  stage: Stage.TOB_VERZIK,
                  status: StageStatus.STARTED,
                  accurate: true,
                  recordedTicks: 2,
                  serverTicks: { count: 2, precise: true },
                },
                [
                  createNpcSpawnEvent({
                    tick: 0,
                    roomId: 1,
                    npcId: 8372,
                    x: 3168,
                    y: 4314,
                    hitpointsCurrent: 1000,
                    stage: Stage.TOB_VERZIK,
                  }),
                  // Player 1 starts in melee range
                  createPlayerUpdateEvent({
                    tick: 0,
                    name: 'player1',
                    x: 3168,
                    y: 4313,
                    stage: Stage.TOB_VERZIK,
                  }),
                  // Player 2 is not in melee range
                  createPlayerUpdateEvent({
                    tick: 0,
                    name: 'player2',
                    x: 3160,
                    y: 4310,
                    stage: Stage.TOB_VERZIK,
                  }),
                  createNpcAttackEvent({
                    tick: 0,
                    attack: NpcAttack.TOB_VERZIK_P2_BOUNCE,
                    stage: Stage.TOB_VERZIK,
                  }),
                  // Player 1 ends up 5 tiles from center
                  createPlayerUpdateEvent({
                    tick: 1,
                    name: 'player1',
                    x: 3168,
                    y: 4309,
                    stage: Stage.TOB_VERZIK,
                  }),
                  // Player 2 doesn't move
                  createPlayerUpdateEvent({
                    tick: 1,
                    name: 'player2',
                    x: 3160,
                    y: 4310,
                    stage: Stage.TOB_VERZIK,
                  }),
                ],
              );

              expect(client.hasConsistencyIssues()).toBe(false);
              expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
                false,
              );
            });

            it('flags movement when multiple players moved', () => {
              const client = ClientEvents.fromRawEvents(
                25,
                { ...challengeInfo, party: ['player1', 'player2'] },
                {
                  stage: Stage.TOB_VERZIK,
                  status: StageStatus.STARTED,
                  accurate: true,
                  recordedTicks: 2,
                  serverTicks: { count: 2, precise: true },
                },
                [
                  // Both players start in melee range
                  createPlayerUpdateEvent({
                    tick: 0,
                    name: 'player1',
                    x: 3168,
                    y: 4313,
                    stage: Stage.TOB_VERZIK,
                  }),
                  createPlayerUpdateEvent({
                    tick: 0,
                    name: 'player2',
                    x: 3169,
                    y: 4313,
                    stage: Stage.TOB_VERZIK,
                  }),
                  createNpcAttackEvent({
                    tick: 0,
                    attack: NpcAttack.TOB_VERZIK_P2_BOUNCE,
                    stage: Stage.TOB_VERZIK,
                  }),
                  // Both players end up 5 tiles from center
                  createPlayerUpdateEvent({
                    tick: 1,
                    name: 'player1',
                    x: 3168,
                    y: 4309,
                    stage: Stage.TOB_VERZIK,
                  }),
                  createPlayerUpdateEvent({
                    tick: 1,
                    name: 'player2',
                    x: 3173,
                    y: 4314,
                    stage: Stage.TOB_VERZIK,
                  }),
                ],
              );

              expect(client.hasConsistencyIssues()).toBe(true);
              expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
                true,
              );
            });

            it('flags bounce when player was not in bounceable area', () => {
              const client = ClientEvents.fromRawEvents(
                26,
                { ...challengeInfo, party: ['player1'] },
                {
                  stage: Stage.TOB_VERZIK,
                  status: StageStatus.STARTED,
                  accurate: true,
                  recordedTicks: 2,
                  serverTicks: { count: 2, precise: true },
                },
                [
                  // Player 1 is not in melee range
                  createPlayerUpdateEvent({
                    tick: 0,
                    name: 'player1',
                    x: 3160,
                    y: 4310,
                    stage: Stage.TOB_VERZIK,
                  }),
                  createNpcAttackEvent({
                    tick: 0,
                    attack: NpcAttack.TOB_VERZIK_P2_BOUNCE,
                    stage: Stage.TOB_VERZIK,
                  }),
                  // Player ends up 5 tiles from center anyway
                  createPlayerUpdateEvent({
                    tick: 1,
                    name: 'player1',
                    x: 3168,
                    y: 4319,
                    stage: Stage.TOB_VERZIK,
                  }),
                ],
              );

              expect(client.hasConsistencyIssues()).toBe(true);
              expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
                true,
              );
            });

            it('flags movement when no attack event is present', () => {
              const client = ClientEvents.fromRawEvents(
                27,
                { ...challengeInfo, party: ['player1'] },
                {
                  stage: Stage.TOB_VERZIK,
                  status: StageStatus.STARTED,
                  accurate: true,
                  recordedTicks: 2,
                  serverTicks: { count: 2, precise: true },
                },
                [
                  createPlayerUpdateEvent({
                    tick: 0,
                    name: 'player1',
                    x: 3168,
                    y: 4313,
                    stage: Stage.TOB_VERZIK,
                  }),
                  createPlayerUpdateEvent({
                    tick: 1,
                    name: 'player1',
                    x: 3168,
                    y: 4309,
                    stage: Stage.TOB_VERZIK,
                  }),
                ],
              );

              expect(client.hasConsistencyIssues()).toBe(true);
              expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
                true,
              );
            });
          });

          it('allows 6-tile corner bounce from Verzik body corner', () => {
            const client = ClientEvents.fromRawEvents(
              28,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createNpcSpawnEvent({
                  tick: 0,
                  roomId: 1,
                  npcId: 8372,
                  x: 3168,
                  y: 4314,
                  hitpointsCurrent: 1000,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3167,
                  y: 4313,
                  stage: Stage.TOB_VERZIK,
                }),
                createVerzikBounceEvent({
                  tick: 1,
                  npcAttackTick: 0,
                  bouncedPlayer: 'player1',
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3162,
                  y: 4308,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(false);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              false,
            );
            expect(client.isAccurate()).toBe(true);
          });
        });

        describe('Sotetseg maze teleport', () => {
          it('allows teleport to overworld maze start tile', () => {
            const client = ClientEvents.fromRawEvents(
              14,
              challengeInfo,
              {
                stage: Stage.TOB_SOTETSEG,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3275,
                  y: 4310,
                  stage: Stage.TOB_SOTETSEG,
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3274,
                  y: 4307,
                  stage: Stage.TOB_SOTETSEG,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(false);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              false,
            );
            expect(client.isAccurate()).toBe(true);
          });

          it('allows teleport to underworld maze start tile', () => {
            const client = ClientEvents.fromRawEvents(
              15,
              challengeInfo,
              {
                stage: Stage.TOB_SOTETSEG,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3280,
                  y: 4320,
                  stage: Stage.TOB_SOTETSEG,
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3360,
                  y: 4309,
                  stage: Stage.TOB_SOTETSEG,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(false);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              false,
            );
            expect(client.isAccurate()).toBe(true);
          });

          it('flags large movement to non-maze tile', () => {
            const client = ClientEvents.fromRawEvents(
              16,
              challengeInfo,
              {
                stage: Stage.TOB_SOTETSEG,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3275,
                  y: 4310,
                  stage: Stage.TOB_SOTETSEG,
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3300,
                  y: 4350,
                  stage: Stage.TOB_SOTETSEG,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
          });

          it('flags maze teleport when not starting from room area', () => {
            const client = ClientEvents.fromRawEvents(
              17,
              challengeInfo,
              {
                stage: Stage.TOB_SOTETSEG,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3200,
                  y: 4200,
                  stage: Stage.TOB_SOTETSEG,
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3274,
                  y: 4307,
                  stage: Stage.TOB_SOTETSEG,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
          });

          it('only applies to 1-tick movement for maze proc', () => {
            const client = ClientEvents.fromRawEvents(
              18,
              challengeInfo,
              {
                stage: Stage.TOB_SOTETSEG,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 3,
                serverTicks: { count: 3, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3275,
                  y: 4312,
                  stage: Stage.TOB_SOTETSEG,
                }),
                createPlayerUpdateEvent({
                  tick: 2,
                  name: 'player1',
                  x: 3274,
                  y: 4307,
                  stage: Stage.TOB_SOTETSEG,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
          });

          it('allows multi-tick teleport from room to underworld', () => {
            const client = ClientEvents.fromRawEvents(
              22,
              challengeInfo,
              {
                stage: Stage.TOB_SOTETSEG,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 6,
                serverTicks: { count: 6, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3275,
                  y: 4310,
                  stage: Stage.TOB_SOTETSEG,
                }),
                createPlayerUpdateEvent({
                  tick: 5,
                  name: 'player1',
                  x: 3360,
                  y: 4315,
                  stage: Stage.TOB_SOTETSEG,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(false);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              false,
            );
          });

          it('allows multi-tick teleport from underworld to room', () => {
            const client = ClientEvents.fromRawEvents(
              23,
              challengeInfo,
              {
                stage: Stage.TOB_SOTETSEG,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 8,
                serverTicks: { count: 8, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3360,
                  y: 4315,
                  stage: Stage.TOB_SOTETSEG,
                }),
                createPlayerUpdateEvent({
                  tick: 7,
                  name: 'player1',
                  x: 3275,
                  y: 4310,
                  stage: Stage.TOB_SOTETSEG,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(false);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              false,
            );
          });
        });

        describe('Verzik P3 webs push', () => {
          it('allows push out when player was inside Verzik', () => {
            const client = ClientEvents.fromRawEvents(
              29,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createNpcSpawnEvent({
                  tick: 0,
                  roomId: 1,
                  npcId: 8374,
                  x: 3168,
                  y: 4312,
                  hitpointsCurrent: 1000,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3168,
                  y: 4312,
                  stage: Stage.TOB_VERZIK,
                }),
                createNpcAttackEvent({
                  tick: 0,
                  attack: NpcAttack.TOB_VERZIK_P3_WEBS,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3168,
                  y: 4308,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(false);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              false,
            );
            expect(client.isAccurate()).toBe(true);
          });

          it('flags movement when destination is not directly adjacent to Verzik', () => {
            const client = ClientEvents.fromRawEvents(
              30,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3168,
                  y: 4312,
                  stage: Stage.TOB_VERZIK,
                }),
                createNpcAttackEvent({
                  tick: 0,
                  attack: NpcAttack.TOB_VERZIK_P3_WEBS,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3168,
                  y: 4307,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
          });

          it('flags movement when player was not inside Verzik', () => {
            const client = ClientEvents.fromRawEvents(
              31,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3160,
                  y: 4310,
                  stage: Stage.TOB_VERZIK,
                }),
                createNpcAttackEvent({
                  tick: 0,
                  attack: NpcAttack.TOB_VERZIK_P3_WEBS,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3168,
                  y: 4308,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
          });

          it('flags movement when no webs attack event is present', () => {
            const client = ClientEvents.fromRawEvents(
              32,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 2,
                serverTicks: { count: 2, precise: true },
              },
              [
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3168,
                  y: 4312,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 1,
                  name: 'player1',
                  x: 3168,
                  y: 4308,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
          });

          it('allows webs attack event up to 3 ticks before movement', () => {
            const client = ClientEvents.fromRawEvents(
              33,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 4,
                serverTicks: { count: 4, precise: true },
              },
              [
                createNpcSpawnEvent({
                  tick: 0,
                  roomId: 1,
                  npcId: 8374,
                  x: 3168,
                  y: 4312,
                  hitpointsCurrent: 1000,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 0,
                  name: 'player1',
                  x: 3168,
                  y: 4312,
                  stage: Stage.TOB_VERZIK,
                }),
                createNpcAttackEvent({
                  tick: 0,
                  attack: NpcAttack.TOB_VERZIK_P3_WEBS,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 3,
                  name: 'player1',
                  x: 3168,
                  y: 4308,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(false);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              false,
            );
            expect(client.isAccurate()).toBe(true);
          });

          it('flags webs attack event more than 3 ticks before movement', () => {
            const client = ClientEvents.fromRawEvents(
              34,
              challengeInfo,
              {
                stage: Stage.TOB_VERZIK,
                status: StageStatus.STARTED,
                accurate: true,
                recordedTicks: 6,
                serverTicks: { count: 6, precise: true },
              },
              [
                createNpcSpawnEvent({
                  tick: 0,
                  roomId: 1,
                  npcId: 8374,
                  x: 3168,
                  y: 4312,
                  hitpointsCurrent: 1000,
                  stage: Stage.TOB_VERZIK,
                }),
                createNpcAttackEvent({
                  tick: 0,
                  attack: NpcAttack.TOB_VERZIK_P3_WEBS,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 4,
                  name: 'player1',
                  x: 3168,
                  y: 4312,
                  stage: Stage.TOB_VERZIK,
                }),
                createPlayerUpdateEvent({
                  tick: 5,
                  name: 'player1',
                  x: 3168,
                  y: 4308,
                  stage: Stage.TOB_VERZIK,
                }),
              ],
            );

            expect(client.hasConsistencyIssues()).toBe(true);
            expect(client.hasAnomaly(ClientAnomaly.CONSISTENCY_ISSUES)).toBe(
              true,
            );
          });
        });
      });
    });
  });

  describe('player state history', () => {
    it('builds player state history with coordinates and deaths', () => {
      const updates = [
        createPlayerUpdateEvent({ tick: 0, name: 'player1', x: 5, y: 5 }),
        createPlayerUpdateEvent({ tick: 1, name: 'player1', x: 6, y: 7 }),
        (() => {
          const death = new ProtoEvent();
          death.setType(EventType.PLAYER_DEATH as ProtoEventType);
          death.setTick(2);
          death.setStage(Stage.TOB_MAIDEN as ProtoStage);
          const player = new ProtoEvent.Player();
          player.setName('player1');
          death.setPlayer(player);
          return death;
        })(),
      ];

      const client = ClientEvents.fromRawEvents(
        7,
        challengeInfo,
        {
          stage: Stage.TOB_MAIDEN,
          status: StageStatus.STARTED,
          accurate: true,
          recordedTicks: 2,
          serverTicks: null,
        },
        updates,
      );

      const tick0 = client.getTickState(0)?.getPlayerState('player1');
      expect(tick0).toMatchObject({ x: 5, y: 5, isDead: false });

      const tick1 = client.getTickState(1)?.getPlayerState('player1');
      expect(tick1).toMatchObject({ x: 6, y: 7, isDead: false });

      const tick2 = client.getTickState(2)?.getPlayerState('player1');
      expect(tick2).toMatchObject({ x: 6, y: 7, isDead: true });
    });

    it('applies equipment deltas when building player state', () => {
      const createUpdate = (
        tick: number,
        deltas: [number, number, boolean][],
      ) => {
        const event = new ProtoEvent();
        event.setType(EventType.PLAYER_UPDATE as ProtoEventType);
        event.setTick(tick);
        event.setStage(Stage.TOB_MAIDEN as ProtoStage);
        const player = new ProtoEvent.Player();
        player.setName('player1');
        player.setDataSource(DataSource.PRIMARY as ProtoDataSource);
        for (const [itemId, slot, added] of deltas) {
          const delta = new ItemDelta(itemId, 1, slot, added);
          player.addEquipmentDeltas(delta.toRaw());
        }
        event.setPlayer(player);
        return event;
      };

      const client = ClientEvents.fromRawEvents(
        8,
        challengeInfo,
        {
          stage: Stage.TOB_MAIDEN,
          status: StageStatus.STARTED,
          accurate: true,
          recordedTicks: 1,
          serverTicks: null,
        },
        [
          createUpdate(0, [[11840, 1, true]]),
          createUpdate(1, [[11840, 1, false]]),
        ],
      );

      const tick0State = client.getTickState(0)?.getPlayerState('player1');
      expect(tick0State?.equipment[1]).toMatchObject({
        id: 11840,
        quantity: 1,
      });
      const tick1State = client.getTickState(1)?.getPlayerState('player1');
      expect(tick1State?.equipment[1]).toBeNull();
    });
  });
});
