import {
  BCFAction,
  BCFActor,
  BCFResolver,
  BCFTick,
  BlertChartFormat,
  validate,
} from '@blert/bcf';

import { deriveState, findOffCooldownTick } from '../attack-cycle';

const VERZIK: BCFActor = {
  id: 'verzik',
  type: 'npc',
  name: 'Verzik Vitur',
  npcId: 8370,
};

const SCYTHE: BCFAction = {
  type: 'attack',
  attackType: 'SCYTHE',
  weaponId: 22325,
};

const DAWN_SPEC: BCFAction = {
  type: 'attack',
  attackType: 'DAWN_SPEC',
  weaponId: 22516,
  specCost: 35,
};

const VERZIK_AUTO: BCFAction = {
  type: 'npcAttack',
  attackType: 'TOB_VERZIK_P1_AUTO',
};

const SURGE_POTION: BCFAction = {
  type: 'utility',
  utilityType: 'SURGE_POTION',
};

function makeChart(ticks: BCFTick[], totalTicks: number): BlertChartFormat {
  return {
    version: '1.0',
    config: { totalTicks, rowOrder: ['verzik', 'p1'] },
    timeline: {
      actors: [VERZIK, { id: 'p1', type: 'player', name: 'Player 1' }],
      ticks,
    },
  };
}

function expectValid(bcf: BlertChartFormat): void {
  const result = validate(bcf);
  expect(result.valid ? [] : result.errors).toEqual([]);
}

describe('deriveState', () => {
  it('marks trailing ticks as off cooldown', () => {
    const bcf = makeChart(
      [{ tick: 0, cells: [{ actorId: 'p1', actions: [SCYTHE] }] }],
      8,
    );

    expect(deriveState(bcf)).toEqual([]);
    expectValid(bcf);
    expect(bcf.timeline.ticks).toEqual([
      { tick: 0, cells: [{ actorId: 'p1', actions: [SCYTHE] }] },
      { tick: 5, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
      { tick: 6, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
      { tick: 7, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
    ]);
  });

  it('marks every tick of an idle player as off cooldown', () => {
    const bcf = makeChart(
      [{ tick: 3, cells: [{ actorId: 'verzik', actions: [VERZIK_AUTO] }] }],
      4,
    );

    deriveState(bcf);

    expectValid(bcf);
    expect(bcf.timeline.ticks).toEqual([
      { tick: 0, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
      { tick: 1, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
      { tick: 2, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
      {
        tick: 3,
        cells: [
          { actorId: 'verzik', actions: [VERZIK_AUTO] },
          { actorId: 'p1', state: { offCooldown: true } },
        ],
      },
    ]);
  });

  it('reports an attack placed during a cooldown', () => {
    const bcf = makeChart(
      [
        { tick: 0, cells: [{ actorId: 'p1', actions: [SCYTHE] }] },
        { tick: 2, cells: [{ actorId: 'p1', actions: [DAWN_SPEC] }] },
      ],
      8,
    );

    expect(deriveState(bcf)).toEqual([
      { actorId: 'p1', tick: 2, offCooldownTick: 5 },
    ]);
    expect(bcf.timeline.ticks).toEqual([
      { tick: 0, cells: [{ actorId: 'p1', actions: [SCYTHE] }] },
      { tick: 2, cells: [{ actorId: 'p1', actions: [DAWN_SPEC] }] },
      { tick: 6, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
      { tick: 7, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
    ]);
  });

  it('ignores non-attack actions', () => {
    const bcf = makeChart(
      [
        { tick: 0, cells: [{ actorId: 'p1', actions: [DAWN_SPEC] }] },
        { tick: 1, cells: [{ actorId: 'p1', actions: [SURGE_POTION] }] },
      ],
      6,
    );

    expect(deriveState(bcf)).toEqual([]);
    expect(bcf.timeline.ticks).toEqual([
      { tick: 0, cells: [{ actorId: 'p1', actions: [DAWN_SPEC] }] },
      { tick: 1, cells: [{ actorId: 'p1', actions: [SURGE_POTION] }] },
      { tick: 4, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
      { tick: 5, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
    ]);
  });

  it('adds cooldown state to a cell that already exists', () => {
    const bcf = makeChart(
      [
        { tick: 0, cells: [{ actorId: 'p1', actions: [DAWN_SPEC] }] },
        { tick: 5, cells: [{ actorId: 'p1', actions: [SURGE_POTION] }] },
      ],
      6,
    );

    deriveState(bcf);

    expectValid(bcf);
    expect(bcf.timeline.ticks).toEqual([
      { tick: 0, cells: [{ actorId: 'p1', actions: [DAWN_SPEC] }] },
      { tick: 4, cells: [{ actorId: 'p1', state: { offCooldown: true } }] },
      {
        tick: 5,
        cells: [
          {
            actorId: 'p1',
            actions: [SURGE_POTION],
            state: { offCooldown: true },
          },
        ],
      },
    ]);
  });
});

describe('findOffCooldownTick', () => {
  it("steps through a player's off-cooldown ticks to either end of the chart", () => {
    const bcf = makeChart(
      [
        { tick: 0, cells: [{ actorId: 'p1', actions: [SCYTHE] }] },
        { tick: 6, cells: [{ actorId: 'p1', actions: [SCYTHE] }] },
      ],
      14,
    );
    deriveState(bcf);
    const resolver = new BCFResolver(bcf);

    const forward = [0, 5, 11, 13].map((tick) =>
      findOffCooldownTick(resolver, 'p1', tick, 'forward'),
    );
    expect(forward).toEqual([5, 11, 12, null]);
    const backward = [13, 11, 5].map((tick) =>
      findOffCooldownTick(resolver, 'p1', tick, 'backward'),
    );
    expect(backward).toEqual([12, 5, null]);
    expect(findOffCooldownTick(resolver, 'verzik', 0, 'forward')).toBeNull();
  });
});
