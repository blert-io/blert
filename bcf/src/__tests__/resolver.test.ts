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

    it('does not persist customStates across ticks', () => {
      const doc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          actors: [{ type: 'player', id: 'p1', name: 'Player1' }],
          ticks: [
            {
              tick: 2,
              cells: [
                { actorId: 'p1', state: { customStates: [{ label: 'test' }] } },
              ],
            },
          ],
        },
      };
      const resolver = new BCFResolver(doc);

      expect(resolver.getPlayerState('p1', 2)?.customStates).toHaveLength(1);
      expect(resolver.getPlayerState('p1', 3)?.customStates).toHaveLength(0);
    });
  });

  describe('NPC state resolution', () => {
    const doc: BlertChartFormat = {
      ...minimalDoc,
      timeline: {
        actors: [{ type: 'npc', id: 'boss', npcId: 1234, name: 'Boss' }],
        ticks: [
          { tick: 2, cells: [{ actorId: 'boss', state: { label: '50' } }] },
        ],
      },
    };

    it('should return empty state for NPC with no cells', () => {
      const resolver = new BCFResolver(doc);

      const state = resolver.getActorState('boss', 1) as ResolvedNpcState;
      expect(state).toBeDefined();
      expect(state.label).toBeUndefined();
    });

    it('should not persist NPC label across ticks', () => {
      const resolver = new BCFResolver(doc);

      expect(
        (resolver.getActorState('boss', 2) as ResolvedNpcState).label,
      ).toBe('50');
      expect(
        (resolver.getActorState('boss', 3) as ResolvedNpcState).label,
      ).toBeUndefined();
    });

    it('should not persist NPC customStates across ticks', () => {
      const npcDoc: BlertChartFormat = {
        ...minimalDoc,
        timeline: {
          actors: [{ type: 'npc', id: 'boss', npcId: 1234, name: 'Boss' }],
          ticks: [
            {
              tick: 2,
              cells: [
                {
                  actorId: 'boss',
                  state: { label: 'x', customStates: [{ label: 'test' }] },
                },
              ],
            },
          ],
        },
      };
      const resolver = new BCFResolver(npcDoc);

      expect(
        (resolver.getActorState('boss', 2) as ResolvedNpcState).customStates,
      ).toHaveLength(1);
      expect(
        (resolver.getActorState('boss', 3) as ResolvedNpcState).customStates,
      ).toHaveLength(0);
    });
  });

  describe('custom rows', () => {
    const doc: BlertChartFormat = {
      ...minimalDoc,
      augmentation: {
        customRows: [
          {
            id: 'orbs',
            name: 'Orbs',
            cells: [
              { tick: 3, label: 'R' },
              { tick: 7, label: 'M' },
            ],
          },
        ],
      },
    };

    it('should get custom row by id', () => {
      const resolver = new BCFResolver(doc);

      const row = resolver.getCustomRow('orbs');
      expect(row).toBeDefined();
      expect(row?.name).toBe('Orbs');
    });

    it('should return undefined for unknown custom row', () => {
      const resolver = new BCFResolver(doc);
      expect(resolver.getCustomRow('unknown')).toBeUndefined();
    });

    it('should get all custom rows', () => {
      const resolver = new BCFResolver(doc);
      expect(resolver.getCustomRows()).toHaveLength(1);
    });

    it('should get custom row cell at tick', () => {
      const resolver = new BCFResolver(doc);

      expect(resolver.getCustomRowCell('orbs', 3)?.label).toBe('R');
      expect(resolver.getCustomRowCell('orbs', 7)?.label).toBe('M');
      expect(resolver.getCustomRowCell('orbs', 5)).toBeUndefined();
    });
  });

  describe('splits', () => {
    const doc: BlertChartFormat = {
      ...minimalDoc,
      augmentation: {
        splits: [
          { tick: 5, name: 'Phase 1' },
          { tick: 10, name: 'Phase 2' },
        ],
      },
    };

    it('should get split at tick', () => {
      const resolver = new BCFResolver(doc);

      expect(resolver.getSplitAtTick(5)?.name).toBe('Phase 1');
      expect(resolver.getSplitAtTick(10)?.name).toBe('Phase 2');
    });

    it('should return undefined for tick without split', () => {
      const resolver = new BCFResolver(doc);
      expect(resolver.getSplitAtTick(3)).toBeUndefined();
    });

    it('should get all splits', () => {
      const resolver = new BCFResolver(doc);
      expect(resolver.getSplits()).toHaveLength(2);
    });
  });

  describe('background colors', () => {
    const doc: BlertChartFormat = {
      ...minimalDoc,
      timeline: {
        actors: [
          { type: 'player', id: 'p1', name: 'Player1' },
          { type: 'player', id: 'p2', name: 'Player2' },
        ],
        ticks: [],
      },
      augmentation: {
        backgroundColors: [
          { tick: 3, color: 'red' },
          { tick: 5, length: 3, color: 'green', intensity: 'high' },
          { tick: 8, color: 'blue', intensity: 'low', rowIds: ['p1'] },
        ],
      },
    };

    it('returns the background color at a specific tick', () => {
      const resolver = new BCFResolver(doc);

      expect(resolver.getBackgroundColorAtTick(3)).toEqual({
        color: 'red',
        intensity: 'medium',
      });
      expect(resolver.getBackgroundColorAtTick(4)).toBeUndefined();
    });

    it('returns the background color for a tick in range', () => {
      const resolver = new BCFResolver(doc);

      expect(resolver.getBackgroundColorAtTick(5)).toEqual({
        color: 'green',
        intensity: 'high',
      });
      expect(resolver.getBackgroundColorAtTick(6)).toEqual({
        color: 'green',
        intensity: 'high',
      });
      expect(resolver.getBackgroundColorAtTick(7)).toEqual({
        color: 'green',
        intensity: 'high',
      });
      expect(resolver.getBackgroundColorAtTick(8, 'p2')).toBeUndefined();
    });

    it('filters by rowId when specified', () => {
      const resolver = new BCFResolver(doc);

      expect(resolver.getBackgroundColorAtTick(8, 'p1')).toEqual({
        color: 'blue',
        intensity: 'low',
      });
      expect(resolver.getBackgroundColorAtTick(8, 'p2')).toBeUndefined();
      expect(resolver.getBackgroundColorAtTick(8)).toBeUndefined();
    });

    it('returns the last defined color when overlapping', () => {
      const overlappingDoc: BlertChartFormat = {
        ...minimalDoc,
        augmentation: {
          backgroundColors: [
            { tick: 1, length: 5, color: 'gray', intensity: 'low' },
            { tick: 3, color: 'purple' },
          ],
        },
      };
      const resolver = new BCFResolver(overlappingDoc);

      expect(resolver.getBackgroundColorAtTick(2)).toEqual({
        color: 'gray',
        intensity: 'low',
      });
      expect(resolver.getBackgroundColorAtTick(3)).toEqual({
        color: 'purple',
        intensity: 'medium',
      });
      expect(resolver.getBackgroundColorAtTick(4)).toEqual({
        color: 'gray',
        intensity: 'low',
      });
    });

    it('exposes all background colors', () => {
      const resolver = new BCFResolver(doc);
      expect(resolver.backgroundColors).toHaveLength(3);
    });
  });
});
