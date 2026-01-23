import {
  LATEST_VERSION,
  parseAndValidate,
  SUPPORTED_VERSIONS,
  validate,
} from '../validator';
import type { BlertChartFormat } from '../types';

const minimalValidBCF: BlertChartFormat = {
  version: '1.0',
  config: { totalTicks: 10 },
  timeline: {
    actors: [{ type: 'player', id: 'p1', name: 'Player 1' }],
    ticks: [],
  },
};

describe('BCF Validator', () => {
  describe('validate()', () => {
    describe('version handling', () => {
      it('should accept valid v1.0 documents with auto-detection', () => {
        const result = validate(minimalValidBCF);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.version).toBe('1.0');
        }
      });

      it('should accept valid v1.0 documents with explicit version', () => {
        const result = validate(minimalValidBCF, { version: '1.0' });
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.version).toBe('1.0');
        }
      });

      it('should reject unsupported version', () => {
        const doc = { ...minimalValidBCF, version: '2.0' };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/version');
          expect(result.errors[0].message).toContain('Unsupported BCF version');
        }
      });

      it('should reject version mismatch when explicit version provided', () => {
        const result = validate(minimalValidBCF, { version: '1.0' as const });
        expect(result.valid).toBe(true);

        const doc = { ...minimalValidBCF, version: '2.0' };
        const mismatchResult = validate(doc, { version: '1.0' });
        expect(mismatchResult.valid).toBe(false);
        if (!mismatchResult.valid) {
          expect(mismatchResult.errors[0].path).toBe('/version');
        }
      });

      it('should reject missing version', () => {
        const doc = {
          config: { totalTicks: 10 },
          timeline: { actors: [], ticks: [] },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/version');
          expect(result.errors[0].message).toContain('Missing required field');
        }
      });

      it('should accept future minor versions in lax mode (auto-detect)', () => {
        const doc = {
          ...minimalValidBCF,
          version: '1.5',
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.version).toBe('1.0');
        }
      });

      it('should reject future minor versions in strict mode', () => {
        const doc = {
          ...minimalValidBCF,
          version: '1.5',
        };
        const result = validate(doc, { strict: true });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/version');
        }
      });
    });

    describe('lax mode', () => {
      it('should accept extra properties at top level', () => {
        const doc = {
          ...minimalValidBCF,
          unknownField: 'some value',
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should accept extra properties in nested objects', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [
              {
                type: 'player' as const,
                id: 'p1',
                name: 'Player 1',
                futureField: 123,
              },
            ],
            ticks: [],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should accept extra properties in cells', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    newStateField: true,
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should accept unknown action types', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [
                      { type: 'superSpecialCustomAction', someField: 'value' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });
    });

    describe('strict mode', () => {
      it('should reject extra properties at top level', () => {
        const doc = {
          ...minimalValidBCF,
          unknownField: 'some value',
        };
        const result = validate(doc, { strict: true });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].message).toContain('additional properties');
        }
      });

      it('should reject extra properties in nested objects', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [
              {
                type: 'player' as const,
                id: 'p1',
                name: 'Player 1',
                futureField: 123,
              },
            ],
            ticks: [],
          },
        };
        const result = validate(doc, { strict: true });
        expect(result.valid).toBe(false);
      });
    });

    describe('schema validation', () => {
      it('should reject invalid structure', () => {
        const result = validate({ version: '1.0' });
        expect(result.valid).toBe(false);
      });

      it('should reject invalid actor type', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'invalid', id: 'p1', name: 'Test' }],
            ticks: [],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toContain('/timeline/actors/0');
        }
      });

      it('should reject invalid action type in strict mode', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player', id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [{ type: 'superSpecialCustomAction' }],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc, { strict: true });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toContain(
            '/timeline/ticks/0/cells/0/actions/0',
          );
        }
      });
    });

    describe('semantic validation', () => {
      it('should reject duplicate actor IDs', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [
              { type: 'player' as const, id: 'p1', name: 'Player 1' },
              { type: 'player' as const, id: 'p1', name: 'Player 2' },
            ],
            ticks: [],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/timeline/actors/1/id');
          expect(result.errors[0].message).toContain('Duplicate actor ID');
        }
      });

      it('should reject invalid actorId in cell', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [{ tick: 1, cells: [{ actorId: 'invalid' }] }],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe(
            '/timeline/ticks/0/cells/0/actorId',
          );
          expect(result.errors[0].message).toContain('does not exist');
        }
      });

      it('should reject tick out of bounds', () => {
        const doc = {
          ...minimalValidBCF,
          config: { totalTicks: 10 },
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [{ tick: 100, cells: [] }],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/timeline/ticks/0/tick');
          expect(result.errors[0].message).toContain('out of bounds');
        }
      });

      it('should accept a valid display range', () => {
        const doc = {
          ...minimalValidBCF,
          config: { totalTicks: 10, startTick: 2, endTick: 8 },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should allow endTick without startTick', () => {
        const doc = {
          ...minimalValidBCF,
          config: { totalTicks: 10, endTick: 8 },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should reject startTick greater than endTick', () => {
        const doc = {
          ...minimalValidBCF,
          config: { totalTicks: 10, startTick: 8, endTick: 3 },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/config/startTick');
          expect(result.errors[0].message).toContain(
            'less than or equal to endTick',
          );
        }
      });

      it('should reject startTick out of bounds', () => {
        const doc = {
          ...minimalValidBCF,
          config: { totalTicks: 10, startTick: 10 },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/config/startTick');
          expect(result.errors[0].message).toContain('out of bounds');
        }
      });

      it('should reject endTick out of bounds', () => {
        const doc = {
          ...minimalValidBCF,
          config: { totalTicks: 10, endTick: 10 },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/config/endTick');
          expect(result.errors[0].message).toContain('out of bounds');
        }
      });

      it('should reject duplicate tick numbers', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              { tick: 1, cells: [] },
              { tick: 1, cells: [] },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/timeline/ticks/1/tick');
          expect(result.errors[0].message).toContain('Duplicate tick');
        }
      });

      it('should reject out-of-order ticks', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              { tick: 5, cells: [] },
              { tick: 3, cells: [] },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/timeline/ticks/1/tick');
          expect(result.errors[0].message).toContain('out of order');
        }
      });

      it('should reject duplicate actor cells in same tick', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [{ actorId: 'p1' }, { actorId: 'p1' }],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe(
            '/timeline/ticks/0/cells/1/actorId',
          );
          expect(result.errors[0].message).toContain('Duplicate actor ID');
          expect(result.errors[0].message).toContain('in tick');
        }
      });

      it('should reject npcAttack action on player actor', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [
                      { type: 'npcAttack' as const, attackType: 'SOME_ATTACK' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe(
            '/timeline/ticks/0/cells/0/actions/0',
          );
          expect(result.errors[0].message).toContain('cannot perform');
          expect(result.errors[0].message).toContain('npcAttack');
        }
      });

      it('should reject npcPhase action on player actor', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [
                      { type: 'npcPhase' as const, phaseType: 'VERZIK_P2' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe(
            '/timeline/ticks/0/cells/0/actions/0',
          );
          expect(result.errors[0].message).toContain('cannot perform');
          expect(result.errors[0].message).toContain('npcPhase');
        }
      });

      it('should reject player actions on npc actor', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [
              { type: 'npc' as const, id: 'npc1', npcId: 1234, name: 'Boss' },
            ],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'npc1',
                    actions: [
                      { type: 'attack' as const, attackType: 'SCYTHE' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe(
            '/timeline/ticks/0/cells/0/actions/0',
          );
          expect(result.errors[0].message).toContain('cannot perform');
        }
      });

      it('should reject utility action on npc actor', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [
              { type: 'npc' as const, id: 'npc1', npcId: 1234, name: 'Boss' },
            ],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'npc1',
                    actions: [
                      { type: 'utility' as const, utilityType: 'SURGE_POTION' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe(
            '/timeline/ticks/0/cells/0/actions/0',
          );
          expect(result.errors[0].message).toContain('cannot perform');
        }
      });

      it('should allow npcAttack action on npc actor', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [
              { type: 'npc' as const, id: 'npc1', npcId: 1234, name: 'Boss' },
            ],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'npc1',
                    actions: [
                      { type: 'npcAttack' as const, attackType: 'SOME_ATTACK' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should allow npcPhase action on npc actor', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [
              { type: 'npc' as const, id: 'npc1', npcId: 1234, name: 'Boss' },
            ],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'npc1',
                    actions: [
                      { type: 'npcPhase' as const, phaseType: 'VERZIK_P2' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should allow utility action on player actor', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [
                      { type: 'utility' as const, utilityType: 'SURGE_POTION' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should reject invalid targetActorId in action', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [
                      {
                        type: 'attack' as const,
                        attackType: 'SCYTHE',
                        targetActorId: 'invalid',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe(
            '/timeline/ticks/0/cells/0/actions/0/targetActorId',
          );
          expect(result.errors[0].message).toContain('Target actor ID');
        }
      });

      it('should reject duplicate action types in same cell', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [
                      { type: 'attack' as const, attackType: 'SCYTHE' },
                      { type: 'attack' as const, attackType: 'HAMMER' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe(
            '/timeline/ticks/0/cells/0/actions/1',
          );
          expect(result.errors[0].message).toContain('Duplicate action type');
        }
      });

      it('should allow multiple different action types in same cell', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [
                      { type: 'attack' as const, attackType: 'SCYTHE' },
                      { type: 'spell' as const, spellType: 'VENGEANCE' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should allow specCost on _SPEC attacks', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [
                      {
                        type: 'attack' as const,
                        attackType: 'DAWN_SPEC',
                        specCost: 35,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should reject specCost on non-_SPEC attacks', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [
                      {
                        type: 'attack' as const,
                        attackType: 'SCYTHE',
                        specCost: 50,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe(
            '/timeline/ticks/0/cells/0/actions/0/specCost',
          );
          expect(result.errors[0].message).toContain('_SPEC');
        }
      });

      it('should allow _SPEC attacks without specCost', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            actors: [{ type: 'player' as const, id: 'p1', name: 'Player 1' }],
            ticks: [
              {
                tick: 1,
                cells: [
                  {
                    actorId: 'p1',
                    actions: [
                      { type: 'attack' as const, attackType: 'DAWN_SPEC' },
                    ],
                  },
                ],
              },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should reject rowOrder with nonexistent actor ID', () => {
        const doc = {
          ...minimalValidBCF,
          config: {
            totalTicks: 10,
            rowOrder: ['nonexistent', 'p1'],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/config/rowOrder/0');
          expect(result.errors[0].message).toContain('does not reference');
        }
      });

      it('should accept valid phases array', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            ...minimalValidBCF.timeline,
            phases: [
              { tick: 0, phaseType: 'WAVE_1' },
              { tick: 5, phaseType: 'WAVE_2' },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should accept empty phases array', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            ...minimalValidBCF.timeline,
            phases: [],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(true);
      });

      it('should reject duplicate phase tick numbers', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            ...minimalValidBCF.timeline,
            phases: [
              { tick: 5, phaseType: 'WAVE_1' },
              { tick: 5, phaseType: 'WAVE_2' },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/timeline/phases/1/tick');
          expect(result.errors[0].message).toContain('Duplicate');
        }
      });

      it('should reject out-of-order phases', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            ...minimalValidBCF.timeline,
            phases: [
              { tick: 5, phaseType: 'WAVE_2' },
              { tick: 3, phaseType: 'WAVE_1' },
            ],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/timeline/phases/1/tick');
          expect(result.errors[0].message).toContain('out of order');
        }
      });

      it('should reject phase tick out of bounds', () => {
        const doc = {
          ...minimalValidBCF,
          timeline: {
            ...minimalValidBCF.timeline,
            phases: [{ tick: 100, phaseType: 'WAVE_1' }],
          },
        };
        const result = validate(doc);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors[0].path).toBe('/timeline/phases/0/tick');
          expect(result.errors[0].message).toContain('out of bounds');
        }
      });

      describe('NPC lifecycle validation', () => {
        it('should accept valid spawnTick and deathTick', () => {
          const doc = {
            ...minimalValidBCF,
            timeline: {
              actors: [
                {
                  type: 'npc' as const,
                  id: 'verzik',
                  npcId: 8370,
                  name: 'Verzik Vitur',
                  spawnTick: 2,
                  deathTick: 8,
                },
              ],
              ticks: [
                {
                  tick: 5,
                  cells: [
                    {
                      actorId: 'verzik',
                      actions: [
                        {
                          type: 'npcAttack' as const,
                          attackType: 'TOB_VERZIK_P2_BOUNCE',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          };
          const result = validate(doc);
          expect(result.valid).toBe(true);
        });

        it('should accept NPC with only deathTick', () => {
          const doc = {
            ...minimalValidBCF,
            timeline: {
              actors: [
                {
                  type: 'npc' as const,
                  id: 'verzik',
                  npcId: 8370,
                  name: 'Verzik Vitur',
                  deathTick: 8,
                },
              ],
              ticks: [],
            },
          };
          const result = validate(doc);
          expect(result.valid).toBe(true);
        });

        it('should reject spawnTick out of bounds', () => {
          const doc = {
            ...minimalValidBCF,
            timeline: {
              actors: [
                {
                  type: 'npc' as const,
                  id: 'verzik',
                  npcId: 8370,
                  name: 'Verzik Vitur',
                  spawnTick: 100,
                },
              ],
              ticks: [],
            },
          };
          const result = validate(doc);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.errors[0].path).toBe('/timeline/actors/0/spawnTick');
            expect(result.errors[0].message).toContain('out of bounds');
          }
        });

        it('should reject deathTick out of bounds', () => {
          const doc = {
            ...minimalValidBCF,
            timeline: {
              actors: [
                {
                  type: 'npc' as const,
                  id: 'verzik',
                  npcId: 8370,
                  name: 'Verzik Vitur',
                  deathTick: 100,
                },
              ],
              ticks: [],
            },
          };
          const result = validate(doc);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.errors[0].path).toBe('/timeline/actors/0/deathTick');
            expect(result.errors[0].message).toContain('out of bounds');
          }
        });

        it('should reject deathTick equal to spawnTick', () => {
          const doc = {
            ...minimalValidBCF,
            timeline: {
              actors: [
                {
                  type: 'npc' as const,
                  id: 'verzik',
                  npcId: 8370,
                  name: 'Verzik Vitur',
                  spawnTick: 5,
                  deathTick: 5,
                },
              ],
              ticks: [],
            },
          };
          const result = validate(doc);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.errors[0].path).toBe('/timeline/actors/0/deathTick');
            expect(result.errors[0].message).toContain(
              'greater than spawnTick',
            );
          }
        });

        it('should reject deathTick less than spawnTick', () => {
          const doc = {
            ...minimalValidBCF,
            timeline: {
              actors: [
                {
                  type: 'npc' as const,
                  id: 'verzik',
                  npcId: 8370,
                  name: 'Verzik Vitur',
                  spawnTick: 5,
                  deathTick: 3,
                },
              ],
              ticks: [],
            },
          };
          const result = validate(doc);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.errors[0].path).toBe('/timeline/actors/0/deathTick');
            expect(result.errors[0].message).toContain(
              'greater than spawnTick',
            );
          }
        });

        it('should reject NPC cell before spawnTick', () => {
          const doc = {
            ...minimalValidBCF,
            timeline: {
              actors: [
                {
                  type: 'npc' as const,
                  id: 'verzik',
                  npcId: 8370,
                  name: 'Verzik Vitur',
                  spawnTick: 5,
                },
              ],
              ticks: [
                {
                  tick: 2,
                  cells: [{ actorId: 'verzik' }],
                },
              ],
            },
          };
          const result = validate(doc);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.errors[0].path).toBe(
              '/timeline/ticks/0/cells/0/actorId',
            );
            expect(result.errors[0].message).toContain('before spawnTick');
          }
        });

        it('should reject NPC cell after deathTick', () => {
          const doc = {
            ...minimalValidBCF,
            timeline: {
              actors: [
                {
                  type: 'npc' as const,
                  id: 'verzik',
                  npcId: 8370,
                  name: 'Verzik Vitur',
                  deathTick: 5,
                },
              ],
              ticks: [
                {
                  tick: 8,
                  cells: [{ actorId: 'verzik' }],
                },
              ],
            },
          };
          const result = validate(doc);
          expect(result.valid).toBe(false);
          if (!result.valid) {
            expect(result.errors[0].path).toBe(
              '/timeline/ticks/0/cells/0/actorId',
            );
            expect(result.errors[0].message).toContain('after deathTick');
          }
        });

        it('should allow NPC cells on spawnTick and deathTick', () => {
          const doc = {
            ...minimalValidBCF,
            timeline: {
              actors: [
                {
                  type: 'npc' as const,
                  id: 'verzik',
                  npcId: 8370,
                  name: 'Verzik Vitur',
                  spawnTick: 4,
                  deathTick: 5,
                },
              ],
              ticks: [
                {
                  tick: 4,
                  cells: [
                    {
                      actorId: 'verzik',
                      actions: [
                        {
                          type: 'npcAttack' as const,
                          attackType: 'TOB_VERZIK_P2_BOUNCE',
                        },
                      ],
                    },
                  ],
                },
                {
                  tick: 5,
                  cells: [
                    {
                      actorId: 'verzik',
                      actions: [
                        {
                          type: 'npcAttack' as const,
                          attackType: 'TOB_VERZIK_P2_BOUNCE',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          };
          const result = validate(doc);
          expect(result.valid).toBe(true);
        });
      });
    });
  });

  describe('parseAndValidate()', () => {
    it('should parse and validate valid JSON', () => {
      const json = JSON.stringify(minimalValidBCF);
      const result = parseAndValidate(json);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid JSON', () => {
      const result = parseAndValidate('not valid json');
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0].path).toBe('/');
        expect(result.errors[0].message).toContain('Invalid JSON');
      }
    });
  });

  describe('exports', () => {
    it('should export SUPPORTED_VERSIONS', () => {
      expect(SUPPORTED_VERSIONS).toContain('1.0');
    });

    it('should export LATEST_VERSION', () => {
      expect(LATEST_VERSION).toBe('1.0');
    });
  });
});
