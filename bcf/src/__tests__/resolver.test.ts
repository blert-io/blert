import { BCFResolver, ResolvedNpcState } from '../resolver';
import type { BlertChartFormat } from '../types';

describe('BCFResolver', () => {
  const minimalDoc: BlertChartFormat = {
    version: '1.0',
    config: { totalTicks: 10 },
    timeline: {
      actors: [{ type: 'player', id: 'p1', name: 'Player1' }],
      ticks: [],
    },
  };

  describe('document metadata', () => {
    it('exposes name and description', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        name: 'Test Chart',
        description: 'A test chart',
      };
      const resolver = new BCFResolver(doc);

      expect(resolver.name).toBe('Test Chart');
      expect(resolver.description).toBe('A test chart');
    });

    it('exposes totalTicks and maxTick', () => {
      const resolver = new BCFResolver(minimalDoc);

      expect(resolver.totalTicks).toBe(10);
      expect(resolver.maxTick).toBe(9);
    });

    it('exposes startTick and endTick with defaults', () => {
      const resolver = new BCFResolver(minimalDoc);

      expect(resolver.startTick).toBe(0);
      expect(resolver.endTick).toBe(9);
      expect(resolver.displayTicks).toBe(10);
    });

    it('exposes startTick and endTick from config', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        config: { totalTicks: 10, startTick: 1, endTick: 8 },
      };
      const resolver = new BCFResolver(doc);

      expect(resolver.startTick).toBe(1);
      expect(resolver.endTick).toBe(8);
      expect(resolver.displayTicks).toBe(8);
    });
  });

  describe('actor access', () => {
    const doc: BlertChartFormat = {
      ...minimalDoc,
      timeline: {
        actors: [
          { type: 'player', id: 'p1', name: 'Player1' },
          { type: 'npc', id: 'boss', npcId: 1234, name: 'Boss' },
        ],
        ticks: [],
      },
    };

    it('returns actor by id', () => {
      const resolver = new BCFResolver(doc);

      expect(resolver.getActor('p1')).toEqual({
        type: 'player',
        id: 'p1',
        name: 'Player1',
      });
      expect(resolver.getActor('boss')).toEqual({
        type: 'npc',
        id: 'boss',
        npcId: 1234,
        name: 'Boss',
      });
    });

    it('returns undefined for unknown actor', () => {
      const resolver = new BCFResolver(doc);
      expect(resolver.getActor('unknown')).toBeUndefined();
    });

    it('returns all actors', () => {
      const resolver = new BCFResolver(doc);
      expect(resolver.getActors()).toHaveLength(2);
    });
  });

  describe('tick/cell access', () => {
    const doc: BlertChartFormat = {
      ...minimalDoc,
      timeline: {
        actors: [{ type: 'player', id: 'p1', name: 'Player1' }],
        ticks: [
          {
            tick: 1,
            cells: [
              {
                actorId: 'p1',
                actions: [{ type: 'attack', attackType: 'SCYTHE' }],
              },
            ],
          },
          {
            tick: 5,
            cells: [
              {
                actorId: 'p1',
                actions: [{ type: 'spell', spellType: 'VENGEANCE' }],
              },
            ],
          },
        ],
      },
    };

    it('should get tick by number', () => {
      const resolver = new BCFResolver(doc);

      expect(resolver.getTick(1)).toBeDefined();
      expect(resolver.getTick(1)?.cells).toHaveLength(1);
      expect(resolver.getTick(5)).toBeDefined();
    });

    it('should return undefined for missing tick', () => {
      const resolver = new BCFResolver(doc);

      expect(resolver.getTick(2)).toBeUndefined();
      expect(resolver.getTick(100)).toBeUndefined();
    });

    it('should get cell by actor and tick', () => {
      const resolver = new BCFResolver(doc);

      const cell = resolver.getCell('p1', 1);
      expect(cell).toBeDefined();
      expect(cell?.actions).toHaveLength(1);
      expect(cell?.actions?.[0].type).toBe('attack');
    });

    it('should return undefined for missing cell', () => {
      const resolver = new BCFResolver(doc);

      expect(resolver.getCell('p1', 2)).toBeUndefined();
      expect(resolver.getCell('unknown', 1)).toBeUndefined();
    });

    it('should iterate over ticks with for...of', () => {
      const resolver = new BCFResolver(doc);

      const ticks: number[] = [];
      for (const tick of resolver.ticks()) {
        ticks.push(tick.tick);
      }

      expect(ticks).toEqual([1, 5]);
    });

    it('should return empty iterator for document with no ticks', () => {
      const resolver = new BCFResolver(minimalDoc);

      const ticks: number[] = [];
      for (const tick of resolver.ticks()) {
        ticks.push(tick.tick);
      }

      expect(ticks).toEqual([]);
    });
  });

  describe('player state resolution', () => {
    it('returns default state for player with no cells', () => {
      const resolver = new BCFResolver(minimalDoc);

      const state = resolver.getPlayerState('p1', 1);
      expect(state).toBeDefined();
      expect(state!.isDead).toBe(false);
      expect(state!.specEnergy).toBeUndefined();
      expect(state!.offCooldown).toBeUndefined();
    });

    it('returns undefined for NPC actors', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          actors: [{ type: 'npc', id: 'boss', npcId: 1234, name: 'Boss' }],
          ticks: [],
        },
      };
      const resolver = new BCFResolver(doc);

      expect(resolver.getPlayerState('boss', 1)).toBeUndefined();
    });

    it('returns undefined for unknown actor', () => {
      const resolver = new BCFResolver(minimalDoc);
      expect(resolver.getPlayerState('unknown', 1)).toBeUndefined();
    });

    it('returns undefined for out of bounds tick', () => {
      const resolver = new BCFResolver(minimalDoc);
      expect(resolver.getPlayerState('p1', -1)).toBeUndefined();
      expect(resolver.getPlayerState('p1', 10)).toBeUndefined();
    });

    it('caches resolved state', () => {
      const resolver = new BCFResolver(minimalDoc);

      const state1 = resolver.getPlayerState('p1', 5);
      const state2 = resolver.getPlayerState('p1', 5);
      expect(state1).toBe(state2); // Same object reference
    });

    it('persists isDead across ticks', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          actors: [{ type: 'player', id: 'p1', name: 'Player1' }],
          ticks: [
            {
              tick: 3,
              cells: [{ actorId: 'p1', actions: [{ type: 'death' }] }],
            },
          ],
        },
      };
      const resolver = new BCFResolver(doc);

      expect(resolver.getPlayerState('p1', 2)?.isDead).toBe(false);
      expect(resolver.getPlayerState('p1', 3)?.isDead).toBe(true);
      expect(resolver.getPlayerState('p1', 5)?.isDead).toBe(true);
    });

    it('persists specEnergy across ticks', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          actors: [{ type: 'player', id: 'p1', name: 'Player1' }],
          ticks: [
            { tick: 2, cells: [{ actorId: 'p1', state: { specEnergy: 65 } }] },
            { tick: 5, cells: [{ actorId: 'p1', state: { specEnergy: 30 } }] },
          ],
        },
      };
      const resolver = new BCFResolver(doc);

      expect(resolver.getPlayerState('p1', 0)?.specEnergy).toBeUndefined();
      expect(resolver.getPlayerState('p1', 2)?.specEnergy).toBe(65);
      expect(resolver.getPlayerState('p1', 4)?.specEnergy).toBe(65);
      expect(resolver.getPlayerState('p1', 5)?.specEnergy).toBe(30);
      expect(resolver.getPlayerState('p1', resolver.maxTick)?.specEnergy).toBe(
        30,
      );
    });

    it('does not persist offCooldown across ticks', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          actors: [{ type: 'player', id: 'p1', name: 'Player1' }],
          ticks: [
            {
              tick: 2,
              cells: [{ actorId: 'p1', state: { offCooldown: true } }],
            },
          ],
        },
      };
      const resolver = new BCFResolver(doc);

      expect(resolver.getPlayerState('p1', 2)?.offCooldown).toBe(true);
      expect(resolver.getPlayerState('p1', 3)?.offCooldown).toBeUndefined();
    });
  });

  describe('NPC state resolution', () => {
    const doc: BlertChartFormat = {
      ...minimalDoc,
      timeline: {
        actors: [{ type: 'npc', id: 'boss', npcId: 1234, name: 'Boss' }],
        ticks: [],
      },
    };

    it('should return empty state for NPC', () => {
      const resolver = new BCFResolver(doc);

      const state = resolver.getActorState('boss', 1) as ResolvedNpcState;
      expect(state).toBeDefined();
      expect(state).toEqual({});
    });

    it('should return undefined for player actors', () => {
      const resolver = new BCFResolver(minimalDoc);
      expect(resolver.getNpcState('p1', 1)).toBeUndefined();
    });
  });

  describe('NPC phases', () => {
    it('returns empty array for NPC with no phases', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          actors: [{ type: 'npc', id: 'boss', npcId: 1234, name: 'Boss' }],
          ticks: [
            {
              tick: 1,
              cells: [
                {
                  actorId: 'boss',
                  actions: [
                    { type: 'npcAttack', attackType: 'TOB_MAIDEN_AUTO' },
                  ],
                },
              ],
            },
          ],
        },
      };
      const resolver = new BCFResolver(doc);

      expect(resolver.getNpcPhases('boss')).toEqual([]);
    });

    it('returns empty array for player actors', () => {
      const resolver = new BCFResolver(minimalDoc);
      expect(resolver.getNpcPhases('p1')).toEqual([]);
    });

    it('returns empty array for unknown actors', () => {
      const resolver = new BCFResolver(minimalDoc);
      expect(resolver.getNpcPhases('unknown')).toEqual([]);
    });

    it('returns phases in tick order', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          actors: [{ type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik' }],
          ticks: [
            {
              tick: 0,
              cells: [
                {
                  actorId: 'verzik',
                  actions: [{ type: 'npcPhase', phaseType: 'TOB_VERZIK_P1' }],
                },
              ],
            },
            {
              tick: 20,
              cells: [
                {
                  actorId: 'verzik',
                  actions: [{ type: 'npcPhase', phaseType: 'TOB_VERZIK_P2' }],
                },
              ],
            },
            {
              tick: 50,
              cells: [
                {
                  actorId: 'verzik',
                  actions: [{ type: 'npcPhase', phaseType: 'TOB_VERZIK_P3' }],
                },
              ],
            },
          ],
        },
      };
      const resolver = new BCFResolver(doc);

      const phases = resolver.getNpcPhases('verzik');
      expect(phases).toEqual([
        { tick: 0, phaseType: 'TOB_VERZIK_P1' },
        { tick: 20, phaseType: 'TOB_VERZIK_P2' },
        { tick: 50, phaseType: 'TOB_VERZIK_P3' },
      ]);
    });

    it('returns phases from multiple NPCs independently', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          actors: [
            { type: 'npc', id: 'maiden', npcId: 8360, name: 'Maiden' },
            { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik' },
          ],
          ticks: [
            {
              tick: 5,
              cells: [
                {
                  actorId: 'maiden',
                  actions: [{ type: 'npcPhase', phaseType: 'TOB_MAIDEN_70S' }],
                },
              ],
            },
            {
              tick: 10,
              cells: [
                {
                  actorId: 'verzik',
                  actions: [{ type: 'npcPhase', phaseType: 'TOB_VERZIK_P2' }],
                },
              ],
            },
          ],
        },
      };
      const resolver = new BCFResolver(doc);

      expect(resolver.getNpcPhases('maiden')).toEqual([
        { tick: 5, phaseType: 'TOB_MAIDEN_70S' },
      ]);
      expect(resolver.getNpcPhases('verzik')).toEqual([
        { tick: 10, phaseType: 'TOB_VERZIK_P2' },
      ]);
    });
  });

  describe('encounter phases', () => {
    it('returns empty array when no phases defined', () => {
      const resolver = new BCFResolver(minimalDoc);
      expect(resolver.getEncounterPhases()).toEqual([]);
    });

    it('returns empty array when phases is empty', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          ...minimalDoc.timeline,
          phases: [],
        },
      };
      const resolver = new BCFResolver(doc);
      expect(resolver.getEncounterPhases()).toEqual([]);
    });

    it('returns phases in order', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          ...minimalDoc.timeline,
          phases: [
            { tick: 0, phaseType: 'NYLOCAS_WAVE_1' },
            { tick: 5, phaseType: 'NYLOCAS_WAVE_2' },
            { tick: 8, phaseType: 'NYLOCAS_WAVE_3' },
          ],
        },
      };
      const resolver = new BCFResolver(doc);

      expect(resolver.getEncounterPhases()).toEqual([
        { tick: 0, phaseType: 'NYLOCAS_WAVE_1' },
        { tick: 5, phaseType: 'NYLOCAS_WAVE_2' },
        { tick: 8, phaseType: 'NYLOCAS_WAVE_3' },
      ]);
    });
  });

  describe('NPC lifecycle', () => {
    describe('getNpcSpawnTick', () => {
      it('returns undefined for player actors', () => {
        const resolver = new BCFResolver(minimalDoc);
        expect(resolver.getNpcSpawnTick('p1')).toBeUndefined();
      });

      it('returns undefined for unknown actors', () => {
        const resolver = new BCFResolver(minimalDoc);
        expect(resolver.getNpcSpawnTick('unknown')).toBeUndefined();
      });

      it('returns 0 for NPC without spawnTick', () => {
        const doc: BlertChartFormat = {
          ...minimalDoc,
          timeline: {
            actors: [
              { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik' },
            ],
            ticks: [],
          },
        };
        const resolver = new BCFResolver(doc);
        expect(resolver.getNpcSpawnTick('verzik')).toBe(0);
      });

      it('returns explicit spawnTick value', () => {
        const doc: BlertChartFormat = {
          ...minimalDoc,
          timeline: {
            actors: [
              {
                type: 'npc',
                id: 'crab',
                npcId: 8366,
                name: 'Crab',
                spawnTick: 5,
              },
            ],
            ticks: [],
          },
        };
        const resolver = new BCFResolver(doc);
        expect(resolver.getNpcSpawnTick('crab')).toBe(5);
      });
    });

    describe('getNpcDeathTick', () => {
      it('returns undefined for player actors', () => {
        const resolver = new BCFResolver(minimalDoc);
        expect(resolver.getNpcDeathTick('p1')).toBeUndefined();
      });

      it('returns undefined for unknown actors', () => {
        const resolver = new BCFResolver(minimalDoc);
        expect(resolver.getNpcDeathTick('unknown')).toBeUndefined();
      });

      it('returns undefined for NPC without deathTick', () => {
        const doc: BlertChartFormat = {
          ...minimalDoc,
          timeline: {
            actors: [
              { type: 'npc', id: 'verzik', npcId: 8370, name: 'Verzik' },
            ],
            ticks: [],
          },
        };
        const resolver = new BCFResolver(doc);
        expect(resolver.getNpcDeathTick('verzik')).toBeUndefined();
      });

      it('returns explicit deathTick value', () => {
        const doc: BlertChartFormat = {
          ...minimalDoc,
          timeline: {
            actors: [
              {
                type: 'npc',
                id: 'crab',
                npcId: 8366,
                name: 'Crab',
                deathTick: 8,
              },
            ],
            ticks: [],
          },
        };
        const resolver = new BCFResolver(doc);
        expect(resolver.getNpcDeathTick('crab')).toBe(8);
      });
    });
  });
});
