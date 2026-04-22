import { ChallengeMode, EventType, NpcAttack, Stage } from '@blert/common';
import {
  Event as ProtoEvent,
  StageMap,
} from '@blert/common/generated/event_pb';

import {
  BloatConsistencyChecker,
  ConsistencyIssueType,
  MovementConsistencyChecker,
  NylocasConsistencyChecker,
} from '../consistency';
import { TickStateArray } from '../tick-state';
import {
  createNpcAttackEvent,
  createNpcSpawnEvent,
  createPlayerState,
  createTickState,
  createVerzikBounceEvent,
} from './fixtures';

type ProtoEventType = ProtoEvent.TypeMap[keyof ProtoEvent.TypeMap];
type ProtoStage = StageMap[keyof StageMap];

function createBloatDownEvent(tick: number): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(EventType.TOB_BLOAT_DOWN as ProtoEventType);
  event.setTick(tick);
  event.setStage(Stage.TOB_BLOAT as ProtoStage);
  return event;
}

function createBloatUpEvent(tick: number): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(EventType.TOB_BLOAT_UP as ProtoEventType);
  event.setTick(tick);
  event.setStage(Stage.TOB_BLOAT as ProtoStage);
  return event;
}

function createNyloWaveSpawnEvent(tick: number, wave: number): ProtoEvent {
  const event = new ProtoEvent();
  event.setType(EventType.TOB_NYLO_WAVE_SPAWN as ProtoEventType);
  event.setTick(tick);
  event.setStage(Stage.TOB_NYLOCAS as ProtoStage);

  const nyloWave = new ProtoEvent.NyloWave();
  nyloWave.setWave(wave);
  event.setNyloWave(nyloWave);

  return event;
}

const defaultPlayer = createPlayerState({ username: 'player1', clientId: 1 });

function buildTicks(
  length: number,
  tickEvents: Record<number, ProtoEvent[]>,
): TickStateArray {
  const ticks: TickStateArray = [];
  for (let i = 0; i < length; i++) {
    ticks.push(createTickState(i, [defaultPlayer], tickEvents[i] ?? []));
  }
  return ticks;
}

function buildPlayerTicks(
  party: string[],
  positions: Record<string, { tick: number; x: number; y: number }[]>,
  tickEvents: Record<number, ProtoEvent[]> = {},
): TickStateArray {
  const maxTick = Math.max(
    ...Object.values(positions).flatMap((p) => p.map((s) => s.tick)),
    ...Object.keys(tickEvents).map(Number),
  );
  const positionsByTick = new Map<
    number,
    Map<string, { x: number; y: number }>
  >();
  for (const [name, poses] of Object.entries(positions)) {
    for (const pos of poses) {
      if (!positionsByTick.has(pos.tick)) {
        positionsByTick.set(pos.tick, new Map());
      }
      positionsByTick.get(pos.tick)!.set(name, { x: pos.x, y: pos.y });
    }
  }
  const ticks: TickStateArray = [];
  for (let i = 0; i <= maxTick; i++) {
    const tickPositions = positionsByTick.get(i);
    const players = party
      .filter((name) => tickPositions?.has(name))
      .map((name) => {
        const pos = tickPositions!.get(name)!;
        return createPlayerState({
          username: name,
          clientId: 1,
          x: pos.x,
          y: pos.y,
        });
      });
    ticks.push(createTickState(i, players, tickEvents[i] ?? []));
  }
  return ticks;
}

describe('MovementConsistencyChecker', () => {
  describe('basic movement validation', () => {
    it('reports no issues for movement within 2 tiles per tick', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_MAIDEN, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 0, y: 0 },
          { tick: 1, x: 2, y: 1 },
          { tick: 2, x: 4, y: 2 },
        ],
      });

      const issues = checker.check(ticks);
      expect(issues).toHaveLength(0);
    });

    it('flags movement exceeding 2 tiles per tick', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_MAIDEN, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 0, y: 0 },
          { tick: 1, x: 10, y: 0 },
        ],
      });

      const issues = checker.check(ticks);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        type: ConsistencyIssueType.INVALID_MOVEMENT,
        player: 'player1',
        delta: { x: 10, y: 0 },
        ticksSinceLast: 1,
        lastTick: 0,
        tick: 1,
      });
    });

    it('scales max distance by tick gap', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_MAIDEN, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 0, y: 0 },
          { tick: 3, x: 6, y: 0 },
        ],
      });

      const issues = checker.check(ticks);
      expect(issues).toHaveLength(0);
    });

    it('ignores movement for dead players', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_MAIDEN, [
        'player1',
      ]);
      const ticks: TickStateArray = [
        createTickState(0, [
          createPlayerState({ username: 'player1', clientId: 1, x: 0, y: 0 }),
        ]),
        createTickState(1, [
          createPlayerState({
            username: 'player1',
            clientId: 1,
            x: 50,
            y: 50,
            isDead: true,
          }),
        ]),
      ];

      const issues = checker.check(ticks);
      expect(issues).toHaveLength(0);
    });

    it('tracks each player independently', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_MAIDEN, [
        'player1',
        'player2',
      ]);
      const ticks = buildPlayerTicks(['player1', 'player2'], {
        player1: [
          { tick: 0, x: 0, y: 0 },
          { tick: 1, x: 1, y: 0 },
        ],
        player2: [
          { tick: 0, x: 0, y: 0 },
          { tick: 1, x: 20, y: 0 },
        ],
      });

      const issues = checker.check(ticks);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        player: 'player2',
        delta: { x: 20, y: 0 },
      });
    });

    it('skips null tick states', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_MAIDEN, [
        'player1',
      ]);
      const ticks: TickStateArray = [
        createTickState(0, [
          createPlayerState({ username: 'player1', clientId: 1, x: 0, y: 0 }),
        ]),
        null,
        createTickState(2, [
          createPlayerState({ username: 'player1', clientId: 1, x: 2, y: 2 }),
        ]),
      ];

      const issues = checker.check(ticks);
      expect(issues).toHaveLength(0);
    });

    it('flags large movement across multiple stages with no special teleports', () => {
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
        const checker = new MovementConsistencyChecker(stage, ['player1']);
        const ticks = buildPlayerTicks(['player1'], {
          player1: [
            { tick: 0, x: 0, y: 0 },
            { tick: 1, x: 10, y: 0 },
          ],
        });
        expect(checker.check(ticks)).toHaveLength(1);
      }
    });
  });

  describe('death areas', () => {
    it('allows teleport into Sotetseg death area', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_SOTETSEG, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 3274, y: 4321 },
          { tick: 1, x: 3270, y: 4313 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(0);
    });
  });

  describe('Sotetseg', () => {
    it('allows teleport to overworld maze start tile', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_SOTETSEG, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 3275, y: 4310 },
          { tick: 1, x: 3274, y: 4307 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(0);
    });

    it('allows teleport from room to underworld', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_SOTETSEG, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 3280, y: 4320 },
          { tick: 1, x: 3360, y: 4315 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(0);
    });

    it('allows teleport from underworld to room', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_SOTETSEG, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 3360, y: 4315 },
          { tick: 7, x: 3275, y: 4310 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(0);
    });

    it('flags large movement to non-maze tile', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_SOTETSEG, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 3275, y: 4310 },
          { tick: 1, x: 3300, y: 4350 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('flags maze teleport when not starting from room area', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_SOTETSEG, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 3200, y: 4200 },
          { tick: 1, x: 3274, y: 4307 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('requires 1-tick movement for overworld maze proc', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_SOTETSEG, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 3275, y: 4312 },
          { tick: 2, x: 3274, y: 4307 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('allows multi-tick teleport between room and underworld', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_SOTETSEG, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 3275, y: 4310 },
          { tick: 5, x: 3360, y: 4315 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(0);
    });
  });

  describe('Verzik bounce', () => {
    it('allows bounce when bounce event matches player', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 0, x: 3168, y: 4313 },
            { tick: 1, x: 3168, y: 4309 },
          ],
        },
        {
          0: [
            createNpcSpawnEvent({
              tick: 0,
              roomId: 1,
              npcId: 8372,
              x: 3168,
              y: 4314,
              hitpointsCurrent: 1000,
              stage: Stage.TOB_VERZIK,
            }),
          ],
          1: [
            createVerzikBounceEvent({
              tick: 1,
              npcAttackTick: 0,
              bouncedPlayer: 'player1',
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(0);
    });

    it('flags movement when no Verzik NPC present', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 3168, y: 4313 },
          { tick: 1, x: 3168, y: 4309 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('flags bounce when player does not match', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 0, x: 3168, y: 4313 },
            { tick: 1, x: 3168, y: 4309 },
          ],
        },
        {
          0: [
            createNpcSpawnEvent({
              tick: 0,
              roomId: 1,
              npcId: 8372,
              x: 3168,
              y: 4314,
              hitpointsCurrent: 1000,
              stage: Stage.TOB_VERZIK,
            }),
          ],
          1: [
            createVerzikBounceEvent({
              tick: 1,
              npcAttackTick: 0,
              bouncedPlayer: 'player2',
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('flags movement starting outside bounceable area', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 0, x: 3168, y: 4305 },
            { tick: 1, x: 3168, y: 4309 },
          ],
        },
        {
          1: [
            createVerzikBounceEvent({
              tick: 1,
              npcAttackTick: 0,
              bouncedPlayer: 'player1',
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('only applies to 1-tick movement', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 0, x: 3168, y: 4313 },
            { tick: 2, x: 3168, y: 4303 },
          ],
        },
        {
          0: [
            createNpcSpawnEvent({
              tick: 0,
              roomId: 1,
              npcId: 8372,
              x: 3168,
              y: 4314,
              hitpointsCurrent: 1000,
              stage: Stage.TOB_VERZIK,
            }),
          ],
          1: [
            createVerzikBounceEvent({
              tick: 1,
              npcAttackTick: 0,
              bouncedPlayer: 'player1',
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('allows 6-tile corner bounce', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 0, x: 3167, y: 4313 },
            { tick: 1, x: 3162, y: 4308 },
          ],
        },
        {
          0: [
            createNpcSpawnEvent({
              tick: 0,
              roomId: 1,
              npcId: 8372,
              x: 3168,
              y: 4314,
              hitpointsCurrent: 1000,
              stage: Stage.TOB_VERZIK,
            }),
          ],
          1: [
            createVerzikBounceEvent({
              tick: 1,
              npcAttackTick: 0,
              bouncedPlayer: 'player1',
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(0);
    });

    describe('fallback without bounce event', () => {
      it('allows with attack event when only one player moved', () => {
        const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
          'player1',
          'player2',
        ]);
        const ticks = buildPlayerTicks(
          ['player1', 'player2'],
          {
            player1: [
              { tick: 0, x: 3168, y: 4313 },
              { tick: 1, x: 3168, y: 4309 },
            ],
            player2: [
              { tick: 0, x: 3160, y: 4310 },
              { tick: 1, x: 3160, y: 4310 },
            ],
          },
          {
            0: [
              createNpcSpawnEvent({
                tick: 0,
                roomId: 1,
                npcId: 8372,
                x: 3168,
                y: 4314,
                hitpointsCurrent: 1000,
                stage: Stage.TOB_VERZIK,
              }),
              createNpcAttackEvent({
                tick: 0,
                roomId: 1,
                npcId: 8372,
                attackType: NpcAttack.TOB_VERZIK_P2_BOUNCE,
                stage: Stage.TOB_VERZIK,
              }),
            ],
          },
        );

        expect(checker.check(ticks)).toHaveLength(0);
      });

      it('flags when multiple players made bounce-like movements', () => {
        const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
          'player1',
          'player2',
        ]);
        const ticks = buildPlayerTicks(
          ['player1', 'player2'],
          {
            player1: [
              { tick: 0, x: 3168, y: 4313 },
              { tick: 1, x: 3168, y: 4309 },
            ],
            player2: [
              { tick: 0, x: 3169, y: 4313 },
              { tick: 1, x: 3173, y: 4314 },
            ],
          },
          {
            0: [
              createNpcSpawnEvent({
                tick: 0,
                roomId: 1,
                npcId: 8372,
                x: 3168,
                y: 4314,
                hitpointsCurrent: 1000,
                stage: Stage.TOB_VERZIK,
              }),
              createNpcAttackEvent({
                tick: 0,
                roomId: 1,
                npcId: 8372,
                attackType: NpcAttack.TOB_VERZIK_P2_BOUNCE,
                stage: Stage.TOB_VERZIK,
              }),
            ],
          },
        );

        expect(checker.check(ticks).length).toBeGreaterThanOrEqual(1);
      });

      it('flags when no attack event is present', () => {
        const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
          'player1',
        ]);
        const ticks = buildPlayerTicks(
          ['player1'],
          {
            player1: [
              { tick: 0, x: 3168, y: 4313 },
              { tick: 1, x: 3168, y: 4309 },
            ],
          },
          {
            0: [
              createNpcSpawnEvent({
                tick: 0,
                roomId: 1,
                npcId: 8372,
                x: 3168,
                y: 4314,
                hitpointsCurrent: 1000,
                stage: Stage.TOB_VERZIK,
              }),
            ],
          },
        );

        expect(checker.check(ticks)).toHaveLength(1);
      });
    });
  });

  describe('Verzik P3 webs', () => {
    it('allows push out when player was inside Verzik', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 0, x: 3168, y: 4312 },
            { tick: 1, x: 3168, y: 4308 },
          ],
        },
        {
          0: [
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
              roomId: 1,
              npcId: 8374,
              attackType: NpcAttack.TOB_VERZIK_P3_WEBS,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(0);
    });

    it('flags when destination is not adjacent to Verzik area', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 0, x: 3168, y: 4312 },
            { tick: 1, x: 3168, y: 4307 },
          ],
        },
        {
          0: [
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
              roomId: 1,
              npcId: 8374,
              attackType: NpcAttack.TOB_VERZIK_P3_WEBS,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('flags when player was not inside Verzik', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 0, x: 3160, y: 4310 },
            { tick: 1, x: 3168, y: 4308 },
          ],
        },
        {
          0: [
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
              roomId: 1,
              npcId: 8374,
              attackType: NpcAttack.TOB_VERZIK_P3_WEBS,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('flags when no webs attack event is present', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 0, x: 3168, y: 4312 },
            { tick: 1, x: 3168, y: 4308 },
          ],
        },
        {
          0: [
            createNpcSpawnEvent({
              tick: 0,
              roomId: 1,
              npcId: 8374,
              x: 3168,
              y: 4312,
              hitpointsCurrent: 1000,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('allows webs attack event up to 3 ticks before movement', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 0, x: 3168, y: 4312 },
            { tick: 3, x: 3168, y: 4308 },
          ],
        },
        {
          0: [
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
              roomId: 1,
              npcId: 8374,
              attackType: NpcAttack.TOB_VERZIK_P3_WEBS,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(0);
    });

    it('flags webs attack event more than 3 ticks before movement', () => {
      const checker = new MovementConsistencyChecker(Stage.TOB_VERZIK, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(
        ['player1'],
        {
          player1: [
            { tick: 4, x: 3168, y: 4312 },
            { tick: 5, x: 3168, y: 4308 },
          ],
        },
        {
          0: [
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
              roomId: 1,
              npcId: 8374,
              attackType: NpcAttack.TOB_VERZIK_P3_WEBS,
              stage: Stage.TOB_VERZIK,
            }),
          ],
        },
      );

      expect(checker.check(ticks)).toHaveLength(1);
    });
  });

  describe('Colosseum', () => {
    it('allows boss start teleport before tick 5', () => {
      const checker = new MovementConsistencyChecker(Stage.COLOSSEUM_WAVE_12, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 1800, y: 3100 },
          { tick: 1, x: 1825, y: 3103 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(0);
    });

    it('flags boss start teleport at tick 5 or later', () => {
      const checker = new MovementConsistencyChecker(Stage.COLOSSEUM_WAVE_12, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 4, x: 1800, y: 3100 },
          { tick: 5, x: 1825, y: 3103 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('flags teleport to different tile during cutscene', () => {
      const checker = new MovementConsistencyChecker(Stage.COLOSSEUM_WAVE_12, [
        'player1',
      ]);
      const ticks = buildPlayerTicks(['player1'], {
        player1: [
          { tick: 0, x: 1800, y: 3100 },
          { tick: 1, x: 1830, y: 3110 },
        ],
      });

      expect(checker.check(ticks)).toHaveLength(1);
    });

    it('flags large movement in non-boss waves', () => {
      for (
        let stage = Stage.COLOSSEUM_WAVE_1;
        stage <= Stage.COLOSSEUM_WAVE_11;
        stage++
      ) {
        const checker = new MovementConsistencyChecker(stage, ['player1']);
        const ticks = buildPlayerTicks(['player1'], {
          player1: [
            { tick: 0, x: 1800, y: 3100 },
            { tick: 1, x: 1825, y: 3103 },
          ],
        });

        expect(checker.check(ticks)).toHaveLength(1);
      }
    });
  });
});

describe('BloatConsistencyChecker', () => {
  it('reports no issues for valid down/up sequence', () => {
    const checker = new BloatConsistencyChecker();
    const ticks = buildTicks(6, {
      1: [createBloatDownEvent(1)],
      4: [createBloatUpEvent(4)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(0);
  });

  it('reports no issues for multiple valid down/up cycles', () => {
    const checker = new BloatConsistencyChecker();
    const ticks = buildTicks(12, {
      1: [createBloatDownEvent(1)],
      4: [createBloatUpEvent(4)],
      7: [createBloatDownEvent(7)],
      10: [createBloatUpEvent(10)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(0);
  });

  it('flags consecutive down events', () => {
    const checker = new BloatConsistencyChecker();
    const ticks = buildTicks(6, {
      1: [createBloatDownEvent(1)],
      3: [createBloatDownEvent(3)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: ConsistencyIssueType.INVALID_EVENT_SEQUENCE,
      eventType: EventType.TOB_BLOAT_DOWN,
      tick: 3,
    });
  });

  it('flags up event without preceding down', () => {
    const checker = new BloatConsistencyChecker();
    const ticks = buildTicks(3, {
      1: [createBloatUpEvent(1)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: ConsistencyIssueType.INVALID_EVENT_SEQUENCE,
      eventType: EventType.TOB_BLOAT_UP,
      tick: 1,
    });
  });

  it('reports BAD_DATA for simultaneous down and up events', () => {
    const checker = new BloatConsistencyChecker();
    const ticks = buildTicks(4, {
      1: [createBloatDownEvent(1), createBloatUpEvent(1)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: ConsistencyIssueType.BAD_DATA,
      tick: 1,
    });
  });

  it('stops checking after BAD_DATA', () => {
    const checker = new BloatConsistencyChecker();
    const ticks = buildTicks(6, {
      1: [createBloatDownEvent(1), createBloatUpEvent(1)],
      3: [createBloatUpEvent(3)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe(ConsistencyIssueType.BAD_DATA);
  });
});

describe('NylocasConsistencyChecker', () => {
  it('reports no issues for waves spawning with sufficient gaps', () => {
    const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
    // Waves 1-3 each have a natural stall of 4.
    const ticks = buildTicks(12, {
      0: [createNyloWaveSpawnEvent(0, 1)],
      4: [createNyloWaveSpawnEvent(4, 2)],
      8: [createNyloWaveSpawnEvent(8, 3)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(0);
  });

  it('flags wave spawning too soon after previous wave', () => {
    const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
    // Wave 1 has a natural stall of 4, so wave 2 should not spawn before t4.
    const ticks = buildTicks(6, {
      0: [createNyloWaveSpawnEvent(0, 1)],
      2: [createNyloWaveSpawnEvent(2, 2)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: ConsistencyIssueType.INVALID_EVENT_SEQUENCE,
      eventType: EventType.TOB_NYLO_WAVE_SPAWN,
      tick: 2,
    });
  });

  it('reports no issues for first wave regardless of tick', () => {
    const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
    const ticks = buildTicks(2, {
      0: [createNyloWaveSpawnEvent(0, 1)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(0);
  });

  it('allows wave at exact natural stall boundary', () => {
    const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
    const ticks = buildTicks(5, {
      0: [createNyloWaveSpawnEvent(0, 1)],
      4: [createNyloWaveSpawnEvent(4, 2)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(0);
  });

  it('accounts for cumulative stalls when skipping waves', () => {
    const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
    // Wave 1 at tick 0. Waves 1-4 each have naturalStall=4, wave 5 has 16.
    // Jumping from wave 1 to wave 5 requires stalls of 4+4+4+16 = 28.
    const ticks = buildTicks(30, {
      0: [createNyloWaveSpawnEvent(0, 1)],
      28: [createNyloWaveSpawnEvent(28, 5)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(0);
  });

  it('flags when cumulative stall is not met for skipped waves', () => {
    const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
    // Wave 1 to wave 5 requires 28 ticks minimum.
    const ticks = buildTicks(20, {
      0: [createNyloWaveSpawnEvent(0, 1)],
      15: [createNyloWaveSpawnEvent(15, 5)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: ConsistencyIssueType.INVALID_EVENT_SEQUENCE,
      eventType: EventType.TOB_NYLO_WAVE_SPAWN,
      tick: 15,
    });
  });

  it('reports BAD_DATA for out-of-order waves', () => {
    const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
    const ticks = buildTicks(10, {
      0: [createNyloWaveSpawnEvent(0, 3)],
      5: [createNyloWaveSpawnEvent(5, 1)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: ConsistencyIssueType.BAD_DATA,
      tick: 5,
    });
  });

  it('reports BAD_DATA for duplicate waves', () => {
    const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
    const ticks = buildTicks(10, {
      0: [createNyloWaveSpawnEvent(0, 2)],
      5: [createNyloWaveSpawnEvent(5, 2)],
    });

    const issues = checker.check(ticks);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: ConsistencyIssueType.BAD_DATA,
      tick: 5,
    });
  });

  describe('hard mode prince waves', () => {
    const PRINCE_WAVE = 10;

    it('uses 16-tick stall for prince waves in hard mode', () => {
      const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_HARD);
      const ticks = buildTicks(20, {
        0: [createNyloWaveSpawnEvent(0, PRINCE_WAVE)],
        16: [createNyloWaveSpawnEvent(16, PRINCE_WAVE + 1)],
      });

      expect(checker.check(ticks)).toHaveLength(0);
    });

    it('flags wave arriving before prince stall in hard mode', () => {
      const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_HARD);
      const ticks = buildTicks(15, {
        0: [createNyloWaveSpawnEvent(0, PRINCE_WAVE)],
        10: [createNyloWaveSpawnEvent(10, PRINCE_WAVE + 1)],
      });

      const issues = checker.check(ticks);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        type: ConsistencyIssueType.INVALID_EVENT_SEQUENCE,
      });
    });

    it('uses natural stall for prince waves in regular mode', () => {
      const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
      const ticks = buildTicks(10, {
        0: [createNyloWaveSpawnEvent(0, PRINCE_WAVE)],
        8: [createNyloWaveSpawnEvent(8, PRINCE_WAVE + 1)],
      });

      expect(checker.check(ticks)).toHaveLength(0);
    });
  });

  describe('wave range validation', () => {
    it('reports BAD_DATA for wave above 31', () => {
      const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
      const ticks = buildTicks(3, {
        0: [createNyloWaveSpawnEvent(0, 32)],
      });

      const issues = checker.check(ticks);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        type: ConsistencyIssueType.BAD_DATA,
        tick: 0,
      });
    });

    it('reports BAD_DATA for wave 0', () => {
      const checker = new NylocasConsistencyChecker(ChallengeMode.TOB_REGULAR);
      const ticks = buildTicks(3, {
        0: [createNyloWaveSpawnEvent(0, 0)],
      });

      const issues = checker.check(ticks);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        type: ConsistencyIssueType.BAD_DATA,
        tick: 0,
      });
    });
  });
});
