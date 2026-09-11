import {
  BCFAction,
  BCFActor,
  BCFTick,
  BlertChartFormat,
  validate,
} from '@blert/bcf';

import {
  CellBlock,
  addActor,
  clearCells,
  duplicateActor,
  insertTicks,
  pasteCells,
  removeTicks,
  removeActor,
  removeCell,
  setCell,
  setRowOrder,
  setTotalTicks,
  updateMeta,
  translateCells,
} from '../bcf-mutator';

const VERZIK: BCFActor = {
  id: 'verzik',
  type: 'npc',
  name: 'Verzik Vitur',
  npcId: 8370,
};

const MAIDEN: BCFActor = {
  id: 'maiden',
  type: 'npc',
  name: 'The Maiden of Sugadinti',
  npcId: 8360,
};

const JAL_ZEK: BCFActor = {
  id: 'mage',
  type: 'npc',
  name: 'Jal-Zek',
  npcId: 7699,
};

function makeChart(
  ticks: BCFTick[] = [],
  npc: BCFActor = VERZIK,
  playerIds: string[] = ['p1', 'p2'],
): BlertChartFormat {
  const actors: BCFActor[] = [
    npc,
    ...playerIds.map((id, i) => ({
      id,
      type: 'player' as const,
      name: `Player ${i + 1}`,
    })),
  ];

  return {
    version: '1.0',
    config: { totalTicks: 30, rowOrder: actors.map((a) => a.id) },
    timeline: { actors, ticks },
  };
}

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

const TWISTED_BOW: BCFAction = {
  type: 'attack',
  attackType: 'TWISTED_BOW',
  weaponId: 20997,
};

const MAUL_SPEC: BCFAction = {
  type: 'attack',
  attackType: 'ELDER_MAUL_SPEC',
  weaponId: 21003,
};

const VERZIK_AUTO: BCFAction = {
  type: 'npcAttack',
  attackType: 'TOB_VERZIK_P1_AUTO',
};

const MAIDEN_AUTO: BCFAction = {
  type: 'npcAttack',
  attackType: 'TOB_MAIDEN_AUTO',
};

function makeChartWithWindow(): BlertChartFormat {
  const bcf = makeChart(SILLY_P1);
  bcf.config.startTick = 1;
  bcf.config.endTick = 24;
  return bcf;
}

function expectValid(bcf: BlertChartFormat): void {
  const result = validate(bcf);
  expect(result.valid ? [] : result.errors).toEqual([]);
}

function ticksAsJson(bcf: BlertChartFormat): string[] {
  return bcf.timeline.ticks.map((entry) => JSON.stringify(entry));
}

describe('addActor', () => {
  const P3: BCFActor = { id: 'p3', type: 'player', name: 'Player 3' };

  it('appends the actor when no position is given', () => {
    const result = addActor(makeChart(), P3);
    expectValid(result);
    expect(result.timeline.actors).toContainEqual(P3);
    expect(result.config.rowOrder).toEqual(['verzik', 'p1', 'p2', 'p3']);
  });

  it('inserts the actor at the given row', () => {
    const result = addActor(makeChart(), P3, 1);
    expectValid(result);
    expect(result.config.rowOrder).toEqual(['verzik', 'p3', 'p1', 'p2']);
  });

  it('sets document row order if it is missing', () => {
    const bcf = makeChart();
    delete bcf.config.rowOrder;

    const result = addActor(bcf, P3, 0);

    expectValid(result);
    expect(result.config.rowOrder).toEqual(['p3', 'verzik', 'p1', 'p2']);
  });

  it('does not touch existing cells', () => {
    const result = addActor(makeChart(SILLY_P1), P3, 0);
    expectValid(result);
    expect(result.timeline.ticks).toEqual(SILLY_P1);
  });

  it('throws for a duplicate actor id', () => {
    expect(() =>
      addActor(makeChart(), { id: 'p1', type: 'player', name: 'Other' }),
    ).toThrow('Duplicate actor');
  });

  it('throws if the position is out of bounds', () => {
    expect(() => addActor(makeChart(), P3, 4)).toThrow('out of bounds');
    expect(() => addActor(makeChart(), P3, -1)).toThrow('out of bounds');
  });

  it('does not modify the input document', () => {
    const bcf = makeChart(SILLY_P1);
    const before = structuredClone(bcf);

    addActor(bcf, P3, 1);
    expect(bcf).toEqual(before);
  });
});

describe('setRowOrder', () => {
  it("rearranges the document's rows", () => {
    const result = setRowOrder(makeChart(SILLY_P1), ['p2', 'verzik', 'p1']);
    expectValid(result);
    expect(result.config.rowOrder).toEqual(['p2', 'verzik', 'p1']);
  });

  it('does not modify cells', () => {
    const result = setRowOrder(makeChart(SILLY_P1), ['p2', 'verzik', 'p1']);
    expect(result.timeline.ticks).toEqual(SILLY_P1);
  });

  it('adds rowOrder to a doc without it', () => {
    const bcf = makeChart();
    delete bcf.config.rowOrder;

    const result = setRowOrder(bcf, ['p1', 'p2', 'verzik']);

    expectValid(result);
    expect(result.config.rowOrder).toEqual(['p1', 'p2', 'verzik']);
  });

  it('does not remove the cells of an omitted row', () => {
    const result = setRowOrder(makeChart(SILLY_P1), ['verzik', 'p2']);

    expectValid(result);
    expect(result.config.rowOrder).toEqual(['verzik', 'p2']);
    expect(result.timeline.actors.map((a) => a.id)).toEqual([
      'verzik',
      'p1',
      'p2',
    ]);
    expect(result.timeline.ticks).toEqual(SILLY_P1);
  });

  it('allows existing actor rows that are not in the row order', () => {
    const bcf = makeChart(SILLY_P1);
    bcf.config.rowOrder = ['verzik', 'p2'];

    const result = setRowOrder(bcf, ['verzik', 'p1', 'p2']);

    expectValid(result);
    expect(result.config.rowOrder).toEqual(['verzik', 'p1', 'p2']);
  });

  it('clears the field if called with an empty list', () => {
    const result = setRowOrder(makeChart(SILLY_P1), []);

    expectValid(result);
    expect('rowOrder' in result.config).toBe(false);
  });

  it('throws if a row does not exist', () => {
    expect(() =>
      setRowOrder(makeChart(), ['p2', 'verzik', 'nonexistent']),
    ).toThrow('Unknown actor');
  });

  it('throws if a row is repeated', () => {
    expect(() => setRowOrder(makeChart(), ['p2', 'verzik', 'p2'])).toThrow(
      'Duplicate row: p2',
    );
  });

  it('does not modify the input document', () => {
    const bcf = makeChart(SILLY_P1);
    const before = structuredClone(bcf);

    setRowOrder(bcf, ['p2', 'verzik', 'p1']);
    expect(bcf).toEqual(before);
  });
});

describe('duplicateActor', () => {
  it('places the copy below the source row', () => {
    const result = duplicateActor(makeChart(), 'p1', 'p3', 'Player 3');

    expectValid(result);
    expect(result.config.rowOrder).toEqual(['verzik', 'p1', 'p3', 'p2']);
    expect(result.timeline.actors).toContainEqual({
      id: 'p3',
      type: 'player',
      name: 'Player 3',
    });
  });

  it('copies the cells of the source actor', () => {
    const result = duplicateActor(makeChart(SILLY_P1), 'p1', 'p3', 'Player 3');

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p3","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":5,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p3","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":9,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p3","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":14,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p3","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p3","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p3","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('keeps the copy independent of the source', () => {
    const bcf = duplicateActor(makeChart(SILLY_P1), 'p1', 'p3', 'Player 3');
    let modifiedTick = undefined;
    for (const tick of bcf.timeline.ticks) {
      const cell = tick.cells.find((cell) => cell.actorId === 'p1');
      if (cell !== undefined) {
        modifiedTick = tick;
        cell.state = { offCooldown: true };
        break;
      }
    }

    const copy = modifiedTick?.cells.find((cell) => cell.actorId === 'p3');
    expect(copy?.state).toBeUndefined();
  });

  it('copies an npc with its definition', () => {
    const result = duplicateActor(
      makeChart([], JAL_ZEK, ['player']),
      'mage',
      'mage2',
      'Jal-Zek',
    );

    expectValid(result);
    expect(result.config.rowOrder).toEqual(['mage', 'mage2', 'player']);
    expect(result.timeline.actors).toContainEqual({
      id: 'mage2',
      type: 'npc',
      name: 'Jal-Zek',
      npcId: 7699,
    });
  });

  it('throws if the actor is unknown', () => {
    expect(() =>
      duplicateActor(makeChart(), 'nonexistent', 'p3', 'Player 3'),
    ).toThrow('Unknown actor');
  });

  it('throws if the new ID is taken', () => {
    expect(() => duplicateActor(makeChart(), 'p1', 'p2', 'Player 3')).toThrow(
      'Duplicate actor',
    );
  });

  it('does not modify the input document', () => {
    const bcf = makeChart(SILLY_P1);
    const before = structuredClone(bcf);

    duplicateActor(bcf, 'p1', 'p3', 'Player 3');
    expect(bcf).toEqual(before);
  });
});

describe('removeActor', () => {
  const CHART_WITH_TARGETS: BCFTick[] = [
    {
      tick: 5,
      cells: [
        {
          actorId: 'p2',
          actions: [{ ...TWISTED_BOW, targetActorId: 'maiden' }],
        },
      ],
    },
    {
      tick: 9,
      cells: [
        {
          actorId: 'maiden',
          actions: [{ ...MAIDEN_AUTO, targetActorId: 'p1' }],
        },
        {
          actorId: 'p1',
          actions: [{ ...MAUL_SPEC, targetActorId: 'maiden' }],
        },
      ],
    },
    {
      tick: 10,
      cells: [
        { actorId: 'p2', actions: [{ ...MAUL_SPEC, targetActorId: 'maiden' }] },
      ],
    },
  ];

  it('removes the actor and its cells', () => {
    const result = removeActor(makeChart(SILLY_P1), 'p1');

    expectValid(result);
    expect(result.timeline.actors.map((a) => a.id)).toEqual(['verzik', 'p2']);
    expect(result.config.rowOrder).toEqual(['verzik', 'p2']);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('strips target references to the removed actor', () => {
    const result = removeActor(makeChart(CHART_WITH_TARGETS, MAIDEN), 'maiden');
    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":5,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"TWISTED_BOW","weaponId":20997}]}]}",
        "{"tick":9,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"ELDER_MAUL_SPEC","weaponId":21003}]}]}",
        "{"tick":10,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"ELDER_MAUL_SPEC","weaponId":21003}]}]}",
      ]
    `);
  });

  it('does nothing for an unknown actor', () => {
    const bcf = makeChart(SILLY_P1);
    expect(removeActor(bcf, 'nonexistent')).toEqual(bcf);
  });

  it('throws when removing the only actor', () => {
    expect(() => removeActor(makeChart([], JAL_ZEK, []), JAL_ZEK.id)).toThrow(
      'Cannot remove the last actor',
    );
  });

  it('deletes row order if its last row is removed', () => {
    const bcf = makeChart(SILLY_P1);
    bcf.config.rowOrder = ['verzik'];

    const result = removeActor(bcf, 'verzik');

    expectValid(result);
    expect('rowOrder' in result.config).toBe(false);
    expect(result.timeline.actors.map((a) => a.id)).toEqual(['p1', 'p2']);
  });

  it('does not modify the input document', () => {
    const bcf = makeChart(CHART_WITH_TARGETS, MAIDEN);
    const before = structuredClone(bcf);

    removeActor(bcf, 'maiden');
    expect(bcf).toEqual(before);
  });
});

describe('setCell', () => {
  it('creates a tick entry for a new tick', () => {
    const result = setCell(makeChart(), 'p1', 5, { actions: [SCYTHE] });

    expectValid(result);
    expect(result.timeline.ticks).toEqual([
      { tick: 5, cells: [{ actorId: 'p1', actions: [SCYTHE] }] },
    ]);
  });

  it('inserts tick entries in ascending order', () => {
    let bcf = setCell(makeChart(), 'p1', 10, { actions: [SCYTHE] });
    bcf = setCell(bcf, 'p1', 0, { actions: [SCYTHE] });
    bcf = setCell(bcf, 'p1', 20, { actions: [SCYTHE] });
    bcf = setCell(bcf, 'p1', 15, { actions: [SCYTHE] });

    expectValid(bcf);
    expect(bcf.timeline.ticks.map((t) => t.tick)).toEqual([0, 10, 15, 20]);
  });

  it('adds a cell to an existing tick entry', () => {
    let bcf = setCell(makeChart(), 'verzik', 19, { actions: [VERZIK_AUTO] });
    bcf = setCell(bcf, 'p1', 19, { actions: [SCYTHE] });

    expectValid(bcf);
    expect(bcf.timeline.ticks).toEqual([
      {
        tick: 19,
        cells: [
          { actorId: 'verzik', actions: [VERZIK_AUTO] },
          { actorId: 'p1', actions: [SCYTHE] },
        ],
      },
    ]);
  });

  it("replaces an actor's existing cell on the tick", () => {
    let bcf = setCell(makeChart(), 'p1', 5, { actions: [SCYTHE] });
    bcf = setCell(bcf, 'p1', 5, {
      actions: [SCYTHE],
      state: { specEnergy: 100 },
    });

    expectValid(bcf);
    expect(bcf.timeline.ticks).toEqual([
      {
        tick: 5,
        cells: [
          { actorId: 'p1', actions: [SCYTHE], state: { specEnergy: 100 } },
        ],
      },
    ]);
  });

  it('does not modify the input document', () => {
    const bcf = setCell(makeChart(), 'p1', 5, { actions: [SCYTHE] });
    const before = structuredClone(bcf);

    setCell(bcf, 'p2', 5, { actions: [SCYTHE] });
    expect(bcf).toEqual(before);
  });

  it('is unaffected by later modification of the given cell', () => {
    const cell = { actions: [{ ...SCYTHE }] };
    const bcf = setCell(makeChart(), 'p1', 5, cell);

    cell.actions[0].attackType = 'CHALLY_SWIPE';
    expect(bcf.timeline.ticks[0].cells[0].actions).toEqual([SCYTHE]);
  });

  it('throws if the actor does not exist', () => {
    expect(() =>
      setCell(makeChart(), 'nonexistent', 5, { actions: [SCYTHE] }),
    ).toThrow('Unknown actor');
  });

  it('throws if the tick is out of bounds', () => {
    expect(() => setCell(makeChart(), 'p1', -1, { actions: [SCYTHE] })).toThrow(
      'out of bounds',
    );
    expect(() => setCell(makeChart(), 'p1', 30, { actions: [SCYTHE] })).toThrow(
      'out of bounds',
    );
  });

  it('allows writing a cell outside the display range', () => {
    const result = setCell(makeChartWithWindow(), 'p1', 0, {
      actions: [SCYTHE],
    });

    expectValid(result);
    expect(result.timeline.ticks[0]).toEqual({
      tick: 0,
      cells: [{ actorId: 'p1', actions: [SCYTHE] }],
    });
    expect(result.timeline.ticks.slice(1)).toEqual(SILLY_P1);
  });

  it('allows writing a cell for an actor that is not a displayed row', () => {
    const bcf = makeChart(SILLY_P1);
    bcf.config.rowOrder = ['verzik', 'p2'];

    const result = setCell(bcf, 'p1', 25, { actions: [SCYTHE] });

    expectValid(result);
    expect(result.timeline.ticks.slice(0, -1)).toEqual(SILLY_P1);
    expect(result.timeline.ticks.at(-1)).toEqual({
      tick: 25,
      cells: [{ actorId: 'p1', actions: [SCYTHE] }],
    });
  });

  it('throws if the actor cannot perform the provided actions', () => {
    expect(() =>
      setCell(makeChart(), 'p1', 5, { actions: [VERZIK_AUTO] }),
    ).toThrow('player actor p1 cannot perform "npcAttack"');
  });

  it("throws if the tick is outside an npc's lifetime", () => {
    const bcf = makeChart([], { ...JAL_ZEK, spawnTick: 5, deathTick: 25 });

    expect(() => setCell(bcf, 'mage', 4, {})).toThrow(
      'Tick 4 is before mage spawns (5)',
    );
    expect(() => setCell(bcf, 'mage', 26, {})).toThrow(
      'Tick 26 is after mage dies (25)',
    );
  });
});

describe('removeCell', () => {
  it("removes an actor's cell, keeping others on the tick", () => {
    let bcf = setCell(makeChart(), 'verzik', 19, { actions: [VERZIK_AUTO] });
    bcf = setCell(bcf, 'p1', 19, { actions: [SCYTHE] });

    const result = removeCell(bcf, 'p1', 19);
    expectValid(result);
    expect(result.timeline.ticks).toEqual([
      { tick: 19, cells: [{ actorId: 'verzik', actions: [VERZIK_AUTO] }] },
    ]);
  });

  it('drops the tick entry when its last cell is removed', () => {
    let bcf = setCell(makeChart(), 'p1', 5, { actions: [SCYTHE] });
    bcf = setCell(bcf, 'p1', 10, { actions: [SCYTHE] });

    const result = removeCell(bcf, 'p1', 5);
    expectValid(result);
    expect(result.timeline.ticks.map((t) => t.tick)).toEqual([10]);
  });

  it('does nothing when the actor has no cell on the tick', () => {
    const bcf = setCell(makeChart(), 'p1', 5, { actions: [SCYTHE] });

    expect(removeCell(bcf, 'p2', 5)).toEqual(bcf);
    expect(removeCell(bcf, 'p1', 6)).toEqual(bcf);
  });

  it('does not modify the input document', () => {
    const bcf = setCell(makeChart(), 'p1', 5, { actions: [SCYTHE] });
    const before = structuredClone(bcf);

    removeCell(bcf, 'p1', 5);
    expect(bcf).toEqual(before);
  });
});

const SILLY_P1: BCFTick[] = [
  {
    tick: 1,
    cells: [
      { actorId: 'p1', actions: [DAWN_SPEC] },
      { actorId: 'p2', actions: [SCYTHE] },
    ],
  },
  {
    tick: 5,
    cells: [{ actorId: 'p1', actions: [DAWN_SPEC] }],
  },
  {
    tick: 6,
    cells: [{ actorId: 'p2', actions: [SCYTHE] }],
  },
  { tick: 9, cells: [{ actorId: 'p1', actions: [SCYTHE] }] },
  { tick: 11, cells: [{ actorId: 'p2', actions: [DAWN_SPEC] }] },
  { tick: 14, cells: [{ actorId: 'p1', actions: [SCYTHE] }] },
  { tick: 15, cells: [{ actorId: 'p2', actions: [DAWN_SPEC] }] },
  {
    tick: 19,
    cells: [
      { actorId: 'verzik', actions: [VERZIK_AUTO] },
      { actorId: 'p1', actions: [SCYTHE] },
      { actorId: 'p2', actions: [SCYTHE] },
    ],
  },
  {
    tick: 24,
    cells: [
      { actorId: 'p1', actions: [SCYTHE] },
      { actorId: 'p2', actions: [SCYTHE] },
    ],
  },
];

describe('clearCells', () => {
  it('clears only cells inside the region', () => {
    const result = clearCells(makeChart(SILLY_P1), {
      actorIds: ['p1', 'p2'],
      startTick: 5,
      endTick: 11,
    });

    expectValid(result);
    expect(result.timeline.ticks).toEqual([
      SILLY_P1[0],
      SILLY_P1[5],
      SILLY_P1[6],
      SILLY_P1[7],
      SILLY_P1[8],
    ]);
  });

  it('clears a single cell when the region is one cell', () => {
    const result = clearCells(makeChart(SILLY_P1), {
      actorIds: ['p1'],
      startTick: 19,
      endTick: 19,
    });

    expectValid(result);
    expect(result.timeline.ticks).toEqual([
      ...SILLY_P1.slice(0, 7),
      {
        tick: 19,
        cells: [
          { actorId: 'verzik', actions: [VERZIK_AUTO] },
          { actorId: 'p2', actions: [SCYTHE] },
        ],
      },
      SILLY_P1[8],
    ]);
  });

  it('does nothing if the region does not have cells', () => {
    const bcf = makeChart(SILLY_P1);

    expect(
      clearCells(bcf, { actorIds: ['p2'], startTick: 25, endTick: 29 }),
    ).toEqual(bcf);
  });

  it('does not modify the input document', () => {
    const bcf = makeChart(SILLY_P1);
    const before = structuredClone(bcf);

    clearCells(bcf, { actorIds: ['p1', 'p2'], startTick: 0, endTick: 29 });
    expect(bcf).toEqual(before);
  });
});

describe('translateCells', () => {
  it('shifts a region along the timeline', () => {
    const result = translateCells(
      makeChart(SILLY_P1),
      { actorIds: ['p1'], startTick: 5, endTick: 9 },
      { rows: 0, ticks: 2 },
    );

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":7,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":14,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('moves cells between rows', () => {
    const result = translateCells(
      makeChart(SILLY_P1),
      { actorIds: ['p1'], startTick: 5, endTick: 5 },
      { rows: 1, ticks: 0 },
    );

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":5,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":9,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":14,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('overwrites cells at the destination', () => {
    const result = translateCells(
      makeChart(SILLY_P1),
      { actorIds: ['p1'], startTick: 1, endTick: 1 },
      { rows: 1, ticks: 0 },
    );

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":5,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":9,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":14,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('clears destination cells the region does not replace', () => {
    const result = translateCells(
      makeChart(SILLY_P1),
      { actorIds: ['p1'], startTick: 5, endTick: 6 },
      { rows: 0, ticks: 8 },
    );

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":9,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":13,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('keeps cells when source and destination overlap', () => {
    const result = translateCells(
      makeChart(SILLY_P1),
      { actorIds: ['p1'], startTick: 5, endTick: 9 },
      { rows: 0, ticks: 1 },
    );

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":10,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":14,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('does not modify cells outside of the source and destination regions', () => {
    const region = { actorIds: ['p1'], startTick: 5, endTick: 9 };
    const bcf = makeChart(SILLY_P1);
    const result = translateCells(bcf, region, { rows: 0, ticks: 2 });

    const untouched = (doc: BlertChartFormat) =>
      doc.timeline.ticks
        .filter((entry) => entry.tick < 5 || entry.tick > 11)
        .map((entry) => JSON.stringify(entry));

    expect(untouched(result)).toEqual(untouched(bcf));
  });

  it('throws if the region extends beyond the timeline', () => {
    expect(() =>
      translateCells(
        makeChart(SILLY_P1),
        { actorIds: ['p1'], startTick: 24, endTick: 24 },
        { rows: 0, ticks: 6 },
      ),
    ).toThrow('out of bounds');

    expect(() =>
      translateCells(
        makeChart(SILLY_P1),
        { actorIds: ['verzik'], startTick: 19, endTick: 19 },
        { rows: -1, ticks: 0 },
      ),
    ).toThrow('out of bounds');
  });

  it('throws if a cell would land on an incompatible actor', () => {
    expect(() =>
      translateCells(
        makeChart(SILLY_P1),
        { actorIds: ['p1'], startTick: 5, endTick: 5 },
        { rows: -1, ticks: 0 },
      ),
    ).toThrow('npc actor verzik cannot perform "attack"');
  });

  it("throws if a cell would move outside an npc's lifetime", () => {
    const bcf = makeChart([{ tick: 20, cells: [{ actorId: 'mage' }] }], {
      ...JAL_ZEK,
      spawnTick: 5,
      deathTick: 25,
    });

    expect(() =>
      translateCells(
        bcf,
        { actorIds: ['mage'], startTick: 20, endTick: 20 },
        { rows: 0, ticks: 6 },
      ),
    ).toThrow('Tick 26 is after mage dies (25)');
  });

  it('throws if a source actor does not exist', () => {
    expect(() =>
      translateCells(
        makeChart(SILLY_P1),
        { actorIds: ['nonexistent'], startTick: 0, endTick: 5 },
        { rows: 0, ticks: 1 },
      ),
    ).toThrow('Unknown actor');
  });

  it('does not modify the input document', () => {
    const bcf = makeChart(SILLY_P1);
    const before = structuredClone(bcf);

    translateCells(
      bcf,
      { actorIds: ['p1', 'p2'], startTick: 0, endTick: 19 },
      { rows: 0, ticks: 5 },
    );
    expect(bcf).toEqual(before);
  });
});

describe('pasteCells', () => {
  const SINGLE_PLAYER_BLOCK: CellBlock = {
    cells: [
      { rowOffset: 0, tickOffset: 0, cell: { actions: [DAWN_SPEC] } },
      { rowOffset: 0, tickOffset: 2, cell: { actions: [SCYTHE] } },
    ],
    rows: 1,
    ticks: 5,
  };

  const TWO_PLAYER_BLOCK: CellBlock = {
    cells: [
      { rowOffset: 0, tickOffset: 0, cell: { actions: [SCYTHE] } },
      { rowOffset: 1, tickOffset: 1, cell: { actions: [DAWN_SPEC] } },
    ],
    rows: 2,
    ticks: 3,
  };

  const NPC_BLOCK: CellBlock = {
    cells: [{ rowOffset: 0, tickOffset: 0, cell: { actions: [VERZIK_AUTO] } }],
    rows: 1,
    ticks: 1,
  };

  const NPC_AND_PLAYER_BLOCK: CellBlock = {
    cells: [
      { rowOffset: 0, tickOffset: 0, cell: { actions: [VERZIK_AUTO] } },
      { rowOffset: 1, tickOffset: 2, cell: { actions: [SCYTHE] } },
    ],
    rows: 2,
    ticks: 4,
  };

  it('writes the block at the anchor', () => {
    const result = pasteCells(
      makeChart(SILLY_P1),
      { actorId: 'p1', tick: 20 },
      SINGLE_PLAYER_BLOCK,
    );

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":5,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":9,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":14,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":20,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":22,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('clears destination cells that the block does not fill', () => {
    const result = pasteCells(
      makeChart(SILLY_P1),
      { actorId: 'p1', tick: 5 },
      SINGLE_PLAYER_BLOCK,
    );

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":5,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":7,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":14,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('maps row offsets through row order', () => {
    const result = pasteCells(
      makeChart(SILLY_P1),
      { actorId: 'p1', tick: 20 },
      TWO_PLAYER_BLOCK,
    );

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":5,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":9,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":14,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":20,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":21,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":24,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('pastes an npc row and player rows together', () => {
    const result = pasteCells(
      makeChart(SILLY_P1),
      { actorId: 'verzik', tick: 20 },
      NPC_AND_PLAYER_BLOCK,
    );

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":5,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":6,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":9,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":11,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":14,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":20,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]}]}",
        "{"tick":22,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('clears the destination extent when the block does not have cells', () => {
    const result = pasteCells(
      makeChart(SILLY_P1),
      { actorId: 'p1', tick: 5 },
      {
        cells: [],
        rows: 2,
        ticks: 7,
      },
    );

    expectValid(result);
    expect(ticksAsJson(result)).toMatchInlineSnapshot(`
      [
        "{"tick":1,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":14,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":15,"cells":[{"actorId":"p2","actions":[{"type":"attack","attackType":"DAWN_SPEC","weaponId":22516,"specCost":35}]}]}",
        "{"tick":19,"cells":[{"actorId":"verzik","actions":[{"type":"npcAttack","attackType":"TOB_VERZIK_P1_AUTO"}]},{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
        "{"tick":24,"cells":[{"actorId":"p1","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]},{"actorId":"p2","actions":[{"type":"attack","attackType":"SCYTHE","weaponId":22325}]}]}",
      ]
    `);
  });

  it('does nothing when the block is empty', () => {
    const bcf = makeChart(SILLY_P1);
    expect(
      pasteCells(
        bcf,
        { actorId: 'verzik', tick: 0 },
        {
          cells: [],
          rows: 0,
          ticks: 0,
        },
      ),
    ).toEqual(bcf);
  });

  it('throws if the block extends outside the timeline', () => {
    expect(() =>
      pasteCells(
        makeChart(SILLY_P1),
        { actorId: 'p1', tick: 27 },
        SINGLE_PLAYER_BLOCK,
      ),
    ).toThrow('out of bounds');

    expect(() =>
      pasteCells(
        makeChart(SILLY_P1),
        { actorId: 'p1', tick: -2 },
        SINGLE_PLAYER_BLOCK,
      ),
    ).toThrow('out of bounds');

    expect(() =>
      pasteCells(
        makeChart(SILLY_P1),
        { actorId: 'p2', tick: 20 },
        TWO_PLAYER_BLOCK,
      ),
    ).toThrow('out of bounds');
  });

  it('throws if pasting cells onto an incompatible actor type', () => {
    expect(() =>
      pasteCells(
        makeChart(SILLY_P1),
        { actorId: 'verzik', tick: 20 },
        SINGLE_PLAYER_BLOCK,
      ),
    ).toThrow('npc actor verzik cannot perform "attack"');

    expect(() =>
      pasteCells(makeChart(SILLY_P1), { actorId: 'p1', tick: 20 }, NPC_BLOCK),
    ).toThrow('player actor p1 cannot perform "npcAttack"');

    expect(() =>
      pasteCells(
        makeChart(SILLY_P1),
        { actorId: 'p1', tick: 20 },
        NPC_AND_PLAYER_BLOCK,
      ),
    ).toThrow('player actor p1 cannot perform "npcAttack"');
  });

  it("throws if a cell would land outside an npc's lifetime", () => {
    const bcf = makeChart([], { ...JAL_ZEK, spawnTick: 5, deathTick: 25 });
    const block: CellBlock = {
      cells: [{ rowOffset: 0, tickOffset: 0, cell: {} }],
      rows: 1,
      ticks: 1,
    };

    expect(() => pasteCells(bcf, { actorId: 'mage', tick: 26 }, block)).toThrow(
      'Tick 26 is after mage dies (25)',
    );
  });

  it('throws if the specified offset is outside the block', () => {
    expect(() =>
      pasteCells(
        makeChart(SILLY_P1),
        { actorId: 'p1', tick: 20 },
        {
          cells: [{ rowOffset: 1, tickOffset: 0, cell: { actions: [SCYTHE] } }],
          rows: 1,
          ticks: 1,
        },
      ),
    ).toThrow('outside the block');
  });

  it('throws if the actor does not exist', () => {
    expect(() =>
      pasteCells(
        makeChart(SILLY_P1),
        { actorId: 'nonexistent', tick: 20 },
        SINGLE_PLAYER_BLOCK,
      ),
    ).toThrow('Unknown actor');
  });

  it('does not modify the input document', () => {
    const bcf = makeChart(SILLY_P1);
    const before = structuredClone(bcf);

    pasteCells(bcf, { actorId: 'p1', tick: 5 }, SINGLE_PLAYER_BLOCK);
    expect(bcf).toEqual(before);
  });
});

describe('insertTicks', () => {
  it('moves everything at and after the insertion forward', () => {
    const result = insertTicks(makeChartWithWindow(), 10, 3);

    expectValid(result);
    expect(result).toMatchInlineSnapshot(`
      {
        "config": {
          "endTick": 27,
          "rowOrder": [
            "verzik",
            "p1",
            "p2",
          ],
          "startTick": 1,
          "totalTicks": 33,
        },
        "timeline": {
          "actors": [
            {
              "id": "verzik",
              "name": "Verzik Vitur",
              "npcId": 8370,
              "type": "npc",
            },
            {
              "id": "p1",
              "name": "Player 1",
              "type": "player",
            },
            {
              "id": "p2",
              "name": "Player 2",
              "type": "player",
            },
          ],
          "ticks": [
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p1",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 1,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 5,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 6,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 9,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 14,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 17,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 18,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "TOB_VERZIK_P1_AUTO",
                      "type": "npcAttack",
                    },
                  ],
                  "actorId": "verzik",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 22,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 27,
            },
          ],
        },
        "version": "1.0",
      }
    `);
  });

  it('appends ticks at the end of the timeline', () => {
    const bcf = makeChartWithWindow();
    const result = insertTicks(bcf, 30, 5);

    expectValid(result);
    expect(result.config.totalTicks).toBe(35);
    expect(result.timeline).toEqual(bcf.timeline);
  });

  it('does nothing if inserting 0 ticks', () => {
    const bcf = makeChartWithWindow();

    expect(insertTicks(bcf, 10, 0)).toEqual(bcf);
  });

  it('throws if a tick is out of bounds', () => {
    expect(() => insertTicks(makeChartWithWindow(), 31, 2)).toThrow(
      'out of bounds',
    );
    expect(() => insertTicks(makeChartWithWindow(), -1, 2)).toThrow(
      'out of bounds',
    );
  });

  it('does not modify the input document', () => {
    const bcf = makeChartWithWindow();
    const before = structuredClone(bcf);

    insertTicks(bcf, 10, 3);
    expect(bcf).toEqual(before);
  });
});

describe('removeTicks', () => {
  it('discards the removed ticks and moves later ones earlier', () => {
    const result = removeTicks(makeChartWithWindow(), 10, 3);

    expectValid(result);
    expect(result).toMatchInlineSnapshot(`
      {
        "config": {
          "endTick": 21,
          "rowOrder": [
            "verzik",
            "p1",
            "p2",
          ],
          "startTick": 1,
          "totalTicks": 27,
        },
        "timeline": {
          "actors": [
            {
              "id": "verzik",
              "name": "Verzik Vitur",
              "npcId": 8370,
              "type": "npc",
            },
            {
              "id": "p1",
              "name": "Player 1",
              "type": "player",
            },
            {
              "id": "p2",
              "name": "Player 2",
              "type": "player",
            },
          ],
          "ticks": [
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p1",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 1,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 5,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 6,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 9,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 11,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 12,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "TOB_VERZIK_P1_AUTO",
                      "type": "npcAttack",
                    },
                  ],
                  "actorId": "verzik",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 16,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 21,
            },
          ],
        },
        "version": "1.0",
      }
    `);
  });

  it('drops a display window within the removed ticks', () => {
    const result = removeTicks(makeChartWithWindow(), 24, 3);

    expectValid(result);
    expect(result.config.startTick).toBe(1);
    expect(result.config.endTick).toBeUndefined();
  });

  it('drops a lifecycle which was bound to the removed ticks', () => {
    const bcf = makeChart([], { ...JAL_ZEK, spawnTick: 2, deathTick: 6 });

    const result = removeTicks(bcf, 0, 6);

    expectValid(result);
    expect(result.timeline.actors[0]).toEqual(JAL_ZEK);
  });

  it('does nothing if removing 0 ticks', () => {
    const bcf = makeChartWithWindow();

    expect(removeTicks(bcf, 10, 0)).toEqual(bcf);
  });

  it('throws if the tick is out of bounds', () => {
    expect(() => removeTicks(makeChartWithWindow(), 28, 5)).toThrow(
      'out of bounds',
    );
    expect(() => removeTicks(makeChartWithWindow(), -1, 2)).toThrow(
      'out of bounds',
    );
  });

  it('throws if every tick would be removed', () => {
    expect(() => removeTicks(makeChartWithWindow(), 0, 30)).toThrow(
      'Cannot remove every tick',
    );
  });

  it('does not modify the input document', () => {
    const bcf = makeChartWithWindow();
    const before = structuredClone(bcf);

    removeTicks(bcf, 10, 3);
    expect(bcf).toEqual(before);
  });
});

describe('setTotalTicks', () => {
  it('discards everything beyond the end of a shortened timeline', () => {
    const result = setTotalTicks(makeChartWithWindow(), 12);

    expectValid(result);
    expect(result).toMatchInlineSnapshot(`
      {
        "config": {
          "rowOrder": [
            "verzik",
            "p1",
            "p2",
          ],
          "startTick": 1,
          "totalTicks": 12,
        },
        "timeline": {
          "actors": [
            {
              "id": "verzik",
              "name": "Verzik Vitur",
              "npcId": 8370,
              "type": "npc",
            },
            {
              "id": "p1",
              "name": "Player 1",
              "type": "player",
            },
            {
              "id": "p2",
              "name": "Player 2",
              "type": "player",
            },
          ],
          "ticks": [
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p1",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 1,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 5,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 6,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 9,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 11,
            },
          ],
        },
        "version": "1.0",
      }
    `);
  });

  it('keeps the timeline intact when lengthened', () => {
    const result = setTotalTicks(makeChartWithWindow(), 50);

    expectValid(result);
    expect(result).toMatchInlineSnapshot(`
      {
        "config": {
          "endTick": 24,
          "rowOrder": [
            "verzik",
            "p1",
            "p2",
          ],
          "startTick": 1,
          "totalTicks": 50,
        },
        "timeline": {
          "actors": [
            {
              "id": "verzik",
              "name": "Verzik Vitur",
              "npcId": 8370,
              "type": "npc",
            },
            {
              "id": "p1",
              "name": "Player 1",
              "type": "player",
            },
            {
              "id": "p2",
              "name": "Player 2",
              "type": "player",
            },
          ],
          "ticks": [
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p1",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 1,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 5,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 6,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 9,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 11,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
              ],
              "tick": 14,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "DAWN_SPEC",
                      "specCost": 35,
                      "type": "attack",
                      "weaponId": 22516,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 15,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "TOB_VERZIK_P1_AUTO",
                      "type": "npcAttack",
                    },
                  ],
                  "actorId": "verzik",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 19,
            },
            {
              "cells": [
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p1",
                },
                {
                  "actions": [
                    {
                      "attackType": "SCYTHE",
                      "type": "attack",
                      "weaponId": 22325,
                    },
                  ],
                  "actorId": "p2",
                },
              ],
              "tick": 24,
            },
          ],
        },
        "version": "1.0",
      }
    `);
  });

  it('does nothing if the length is unchanged', () => {
    const bcf = makeChartWithWindow();

    expect(setTotalTicks(bcf, 30)).toEqual(bcf);
  });

  it('throws if the resulting timeline is empty', () => {
    expect(() => setTotalTicks(makeChartWithWindow(), 0)).toThrow(
      'at least one tick',
    );
  });

  it('does not modify the input document', () => {
    const bcf = makeChartWithWindow();
    const before = structuredClone(bcf);

    setTotalTicks(bcf, 12);
    expect(bcf).toEqual(before);
  });
});

describe('updateMeta', () => {
  function makeChartWithMetadata(): BlertChartFormat {
    const bcf = makeChart(SILLY_P1);
    bcf.name = 'sillyp1';
    bcf.description = 'A p1-like thing for testing';
    return bcf;
  }

  it('sets the provided fields', () => {
    const result = updateMeta(makeChartWithMetadata(), {
      name: 'sillyp1v2',
      description: 'Copy of A p1-like thing for testing',
    });

    expectValid(result);
    expect(result.name).toBe('sillyp1v2');
    expect(result.description).toBe('Copy of A p1-like thing for testing');
  });

  it('leaves fields which are not provided alone', () => {
    const result = updateMeta(makeChartWithMetadata(), {
      name: 'sillyp1 v3 final.txt',
    });

    expectValid(result);
    expect(result.name).toBe('sillyp1 v3 final.txt');
    expect(result.description).toBe('A p1-like thing for testing');
  });

  it('clears a field set to null', () => {
    const result = updateMeta(makeChartWithMetadata(), { description: null });

    expectValid(result);
    expect(result.name).toBe('sillyp1');
    expect('description' in result).toBe(false);
  });

  it('does not modify the timeline', () => {
    const result = updateMeta(makeChartWithMetadata(), { name: null });

    expect(result.timeline).toEqual(makeChartWithMetadata().timeline);
    expect(result.config).toEqual(makeChartWithMetadata().config);
  });

  it('does not modify the input document', () => {
    const bcf = makeChartWithMetadata();
    const before = structuredClone(bcf);

    updateMeta(bcf, { name: 'Other', description: null });
    expect(bcf).toEqual(before);
  });
});
