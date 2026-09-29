/** Pure mutation functions over BCF documents.  */

import {
  BCFAction,
  BCFActor,
  BCFCell,
  BCFPhase,
  BCFTick,
  BlertChartFormat,
  actorTypeForAction,
} from '@blert/bcf';

function lowerBound(ticks: BCFTick[], tick: number): number {
  let lo = 0;
  let hi = ticks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ticks[mid].tick < tick) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function assertActor(bcf: BlertChartFormat, actorId: string): void {
  if (!bcf.timeline.actors.some((a) => a.id === actorId)) {
    throw new Error(`Unknown actor: ${actorId}`);
  }
}

/** @throws Error if the document has no actor with `actorId`. */
function rowOf(bcf: BlertChartFormat, actorId: string): number {
  const row = rows(bcf).indexOf(actorId);
  if (row === -1) {
    throw new Error(`Unknown actor: ${actorId}`);
  }
  return row;
}

function assertRow(bcf: BlertChartFormat, row: number): void {
  const count = rows(bcf).length;
  if (row < 0 || row >= count) {
    throw new Error(`Row ${row} is out of bounds [0, ${count})`);
  }
}

function assertTick(bcf: BlertChartFormat, tick: number): void {
  const { totalTicks } = bcf.config;
  if (tick < 0 || tick >= totalTicks) {
    throw new Error(`Tick ${tick} is out of bounds [0, ${totalTicks})`);
  }
}

/** @throws Error if a cell cannot exist on `actorId`'s row at `tick`. */
function assertCompatibleCell(
  bcf: BlertChartFormat,
  actorId: string,
  tick: number,
  cell: Omit<BCFCell, 'actorId'>,
): void {
  const actor = bcf.timeline.actors.find((a) => a.id === actorId);
  if (actor === undefined) {
    throw new Error(`Unknown actor: ${actorId}`);
  }

  for (const action of cell.actions ?? []) {
    const required = actorTypeForAction(action.type);
    if (required !== null && required !== actor.type) {
      throw new Error(
        `${actor.type} actor ${actorId} cannot perform "${action.type}"`,
      );
    }
  }

  if (actor.type === 'npc') {
    const spawnTick = actor.spawnTick ?? 0;
    if (tick < spawnTick) {
      throw new Error(
        `Tick ${tick} is before ${actorId} spawns (${spawnTick})`,
      );
    }
    if (actor.deathTick !== undefined && tick > actor.deathTick) {
      throw new Error(
        `Tick ${tick} is after ${actorId} dies (${actor.deathTick})`,
      );
    }
  }
}

function rows(bcf: BlertChartFormat): string[] {
  return bcf.config.rowOrder?.slice() ?? bcf.timeline.actors.map((a) => a.id);
}

type CellLocation = {
  /** Position in the tick's array, or where a new entry would be inserted. */
  tickIndex: number;
  /** The current entry at `tickIndex`. */
  entry: BCFTick | null;
  /** Position of the actor's cell within `entry` if one exists. */
  cellIndex: number | null;
};

function locate(ticks: BCFTick[], actorId: string, tick: number): CellLocation {
  const tickIndex = lowerBound(ticks, tick);
  if (tickIndex === ticks.length || ticks[tickIndex].tick !== tick) {
    return { tickIndex, entry: null, cellIndex: null };
  }

  const entry = ticks[tickIndex];
  const cellIndex = entry.cells.findIndex((c) => c.actorId === actorId);
  return { tickIndex, entry, cellIndex: cellIndex === -1 ? null : cellIndex };
}

function setUnchecked(
  ticks: BCFTick[],
  actorId: string,
  tick: number,
  cell: BCFCell,
): void {
  const { tickIndex, entry, cellIndex } = locate(ticks, actorId, tick);
  if (entry === null) {
    ticks.splice(tickIndex, 0, { tick, cells: [cell] });
  } else if (cellIndex === null) {
    entry.cells.push(cell);
  } else {
    entry.cells[cellIndex] = cell;
  }
}

function dropCell(
  ticks: BCFTick[],
  tickIndex: number,
  entry: BCFTick,
  cellIndex: number,
): void {
  if (entry.cells.length === 1) {
    ticks.splice(tickIndex, 1);
  } else {
    entry.cells.splice(cellIndex, 1);
  }
}

function clear(ticks: BCFTick[], region: CellRegion): BCFTick[] {
  const actorIds = new Set(region.actorIds);

  return ticks.filter((entry) => {
    if (entry.tick < region.startTick || entry.tick > region.endTick) {
      return true;
    }
    entry.cells = entry.cells.filter((cell) => !actorIds.has(cell.actorId));
    return entry.cells.length > 0;
  });
}

/**
 * Applies `remap` to all fields that reference ticks in the provided document.
 * Fields for which `remap` returns `null` are removed, falling back to their
 * defaults.
 */
function remapTickReferences(
  bcf: BlertChartFormat,
  remap: (tick: number) => number | null,
): void {
  const { config, timeline } = bcf;

  if (config.startTick !== undefined) {
    const tick = remap(config.startTick);
    if (tick === null) {
      delete config.startTick;
    } else {
      config.startTick = tick;
    }
  }
  if (config.endTick !== undefined) {
    const tick = remap(config.endTick);
    if (tick === null) {
      delete config.endTick;
    } else {
      config.endTick = tick;
    }
  }

  if (timeline.phases !== undefined) {
    const phases: BCFPhase[] = [];
    for (const phase of timeline.phases) {
      const tick = remap(phase.tick);
      if (tick !== null) {
        phases.push({ ...phase, tick });
      }
    }
    timeline.phases = phases;
  }

  for (const actor of timeline.actors) {
    if (actor.type !== 'npc') {
      continue;
    }
    if (actor.spawnTick !== undefined) {
      const tick = remap(actor.spawnTick);
      if (tick === null) {
        delete actor.spawnTick;
      } else {
        actor.spawnTick = tick;
      }
    }
    if (actor.deathTick !== undefined) {
      const tick = remap(actor.deathTick);
      if (tick === null) {
        delete actor.deathTick;
      } else {
        actor.deathTick = tick;
      }
    }

    // Actors can't spawn on die on the same tick, so if it remaps to that keep
    // only the spawn.
    if (
      actor.deathTick !== undefined &&
      actor.deathTick <= (actor.spawnTick ?? 0)
    ) {
      delete actor.deathTick;
    }
  }
}

/**
 * Adds `actor` to the document at row `position`, or as the last row if it is
 * omitted.
 *
 * @throws Error if the document already has an actor with the same ID or if
 *   `position` is not a row of the document.
 */
export function addActor(
  bcf: BlertChartFormat,
  actor: BCFActor,
  position?: number,
): BlertChartFormat {
  if (bcf.timeline.actors.some((a) => a.id === actor.id)) {
    throw new Error(`Duplicate actor: ${actor.id}`);
  }

  const order = rows(bcf);
  const index = position ?? order.length;
  if (index < 0 || index > order.length) {
    throw new Error(`Position ${index} is out of bounds [0, ${order.length}]`);
  }

  const next = structuredClone(bcf);
  next.timeline.actors.push(structuredClone(actor));
  order.splice(index, 0, actor.id);
  next.config.rowOrder = order;

  return next;
}

/**
 * Sets the document's displayed rows to `newRowOrder`.
 *
 * @throws Error if `newRowOrder` repeats a row or references an unknown actor.
 */
export function setRowOrder(
  bcf: BlertChartFormat,
  newRowOrder: string[],
): BlertChartFormat {
  const seen = new Set<string>();
  for (const actorId of newRowOrder) {
    assertActor(bcf, actorId);
    if (seen.has(actorId)) {
      throw new Error(`Duplicate row: ${actorId}`);
    }
    seen.add(actorId);
  }

  const next = structuredClone(bcf);
  if (newRowOrder.length > 0) {
    next.config.rowOrder = [...newRowOrder];
  } else {
    delete next.config.rowOrder;
  }
  return next;
}

/**
 * Copies the actor with `actorId` and its cells into a new row below it.
 *
 * @throws Error if the document has no actor with `actorId` or already has
 *   one with `newId`.
 */
export function duplicateActor(
  bcf: BlertChartFormat,
  actorId: string,
  newId: string,
  newName: string,
): BlertChartFormat {
  const actor = bcf.timeline.actors.find((a) => a.id === actorId);
  if (actor === undefined) {
    throw new Error(`Unknown actor: ${actorId}`);
  }

  const copy = { ...structuredClone(actor), id: newId, name: newName };
  const next = addActor(bcf, copy, rowOf(bcf, actorId) + 1);

  for (const entry of next.timeline.ticks) {
    const cell = entry.cells.find((c) => c.actorId === actorId);
    if (cell !== undefined) {
      entry.cells.push({ ...structuredClone(cell), actorId: newId });
    }
  }

  return next;
}

/**
 * Removes the actor with `actorId`, along with its cells and any references
 * to it as another action's target.
 *
 * @throws Error if it is the only actor in the document.
 */
export function removeActor(
  bcf: BlertChartFormat,
  actorId: string,
): BlertChartFormat {
  const next = structuredClone(bcf);

  const index = next.timeline.actors.findIndex((a) => a.id === actorId);
  if (index === -1) {
    return next;
  }
  if (next.timeline.actors.length === 1) {
    throw new Error('Cannot remove the last actor');
  }

  next.timeline.actors.splice(index, 1);

  const order = rows(bcf).filter((id) => id !== actorId);
  if (order.length === 0) {
    delete next.config.rowOrder;
  } else {
    next.config.rowOrder = order;
  }

  const ticks: BCFTick[] = [];
  for (const entry of next.timeline.ticks) {
    const cells: BCFCell[] = [];
    for (const cell of entry.cells) {
      if (cell.actorId === actorId) {
        continue;
      }
      for (const action of cell.actions ?? []) {
        if ('targetActorId' in action && action.targetActorId === actorId) {
          delete action.targetActorId;
        }
      }
      cells.push(cell);
    }

    if (cells.length > 0) {
      entry.cells = cells;
      ticks.push(entry);
    }
  }
  next.timeline.ticks = ticks;

  return next;
}

/**
 * Sets the cell for `actorId` at `tick`, replacing any existing cell for that
 * actor on that tick. Creates the tick entry if it does not yet exist.
 *
 * @throws Error if `tick` is outside `[0, totalTicks)`, if `actorId` does not
 *   reference an actor in the document, or if the cell does not fit the actor.
 */
export function setCell(
  bcf: BlertChartFormat,
  actorId: string,
  tick: number,
  cell: Omit<BCFCell, 'actorId'>,
): BlertChartFormat {
  assertTick(bcf, tick);
  assertCompatibleCell(bcf, actorId, tick, cell);

  const next = structuredClone(bcf);
  const { ticks } = next.timeline;
  const newCell: BCFCell = { actorId, ...structuredClone(cell) };
  setUnchecked(ticks, actorId, tick, newCell);
  return next;
}

/**
 * Adds `action` to the cell for `actorId` at `tick`, replacing any action of
 * the same type already there. Creates the cell and tick entry as needed.
 *
 * @throws Error if `tick` is outside `[0, totalTicks)`, if `actorId` does not
 *   reference an actor in the document, or if the action does not fit the
 *   actor.
 */
export function placeAction(
  bcf: BlertChartFormat,
  actorId: string,
  tick: number,
  action: BCFAction,
): BlertChartFormat {
  assertTick(bcf, tick);
  assertCompatibleCell(bcf, actorId, tick, { actions: [action] });

  const next = structuredClone(bcf);
  const { ticks } = next.timeline;
  const placed = structuredClone(action);

  const { entry, cellIndex } = locate(ticks, actorId, tick);
  if (entry !== null && cellIndex !== null) {
    const cell = entry.cells[cellIndex];
    cell.actions = [
      ...(cell.actions ?? []).filter((a) => a.type !== placed.type),
      placed,
    ];
  } else {
    setUnchecked(ticks, actorId, tick, { actorId, actions: [placed] });
  }
  return next;
}

/** Removes the cell for `actorId` at `tick`, if present. */
export function removeCell(
  bcf: BlertChartFormat,
  actorId: string,
  tick: number,
): BlertChartFormat {
  const next = structuredClone(bcf);
  const { ticks } = next.timeline;

  const { tickIndex, entry, cellIndex } = locate(ticks, actorId, tick);
  if (entry !== null && cellIndex !== null) {
    dropCell(ticks, tickIndex, entry, cellIndex);
  }
  return next;
}

/**
 * Removes the action at `index` from the cell for `actorId` at `tick`,
 * removing the enclosing cell if it is empty.
 *
 * @throws Error if there is no cell for `actorId` at `tick`, or if `index` is
 *   not one of its actions.
 */
export function removeAction(
  bcf: BlertChartFormat,
  actorId: string,
  tick: number,
  index: number,
): BlertChartFormat {
  const next = structuredClone(bcf);
  const { ticks } = next.timeline;

  const { tickIndex, entry, cellIndex } = locate(ticks, actorId, tick);
  if (entry === null || cellIndex === null) {
    throw new Error(`No cell for ${actorId} at tick ${tick}`);
  }

  const cell = entry.cells[cellIndex];
  const actions = cell.actions ?? [];
  if (index < 0 || index >= actions.length) {
    throw new Error(
      `Cell for ${actorId} at tick ${tick} has no action ${index}`,
    );
  }

  actions.splice(index, 1);
  if (actions.length === 0) {
    dropCell(ticks, tickIndex, entry, cellIndex);
  }
  return next;
}

/** A rectangular region of cells. */
export type CellRegion = {
  actorIds: string[];
  /** First tick in the region. */
  startTick: number;
  /** Last tick in the region, inclusive. */
  endTick: number;
};

/** Removes every cell within `region`. */
export function clearCells(
  bcf: BlertChartFormat,
  region: CellRegion,
): BlertChartFormat {
  const next = structuredClone(bcf);
  next.timeline.ticks = clear(next.timeline.ticks, region);
  return next;
}

/** A translation of a cell region. */
export type CellDelta = {
  rows: number;
  ticks: number;
};

/**
 * Moves the cells within `region` by `delta`, overwriting all cells in the
 * destination.
 *
 * @throws Error if the moved region falls outside the document or if a cell
 *   cannot exist at its destination.
 */
export function translateCells(
  bcf: BlertChartFormat,
  region: CellRegion,
  delta: CellDelta,
): BlertChartFormat {
  const order = bcf.config.rowOrder ?? bcf.timeline.actors.map((a) => a.id);

  const destActorIds = region.actorIds.map((actorId) => {
    const row = order.indexOf(actorId);
    if (row === -1) {
      throw new Error(`Unknown actor: ${actorId}`);
    }
    const destRow = row + delta.rows;
    if (destRow < 0 || destRow >= order.length) {
      throw new Error(`Row ${destRow} is out of bounds [0, ${order.length})`);
    }
    return order[destRow];
  });

  const startTick = region.startTick + delta.ticks;
  const endTick = region.endTick + delta.ticks;
  if (startTick < 0 || endTick >= bcf.config.totalTicks) {
    throw new Error(
      `Ticks [${startTick}, ${endTick}] are out of bounds ` +
        `[0, ${bcf.config.totalTicks})`,
    );
  }

  const destinations = new Map(
    region.actorIds.map((actorId, i) => [actorId, destActorIds[i]]),
  );

  const next = structuredClone(bcf);
  const moved: { tick: number; actorId: string; cell: BCFCell }[] = [];

  for (const entry of next.timeline.ticks) {
    if (entry.tick < region.startTick || entry.tick > region.endTick) {
      continue;
    }
    for (const cell of entry.cells) {
      const actorId = destinations.get(cell.actorId);
      if (actorId !== undefined) {
        const tick = entry.tick + delta.ticks;
        assertCompatibleCell(bcf, actorId, tick, cell);
        moved.push({ tick, actorId, cell });
      }
    }
  }

  const { timeline } = next;
  timeline.ticks = clear(timeline.ticks, region);
  timeline.ticks = clear(timeline.ticks, {
    actorIds: destActorIds,
    startTick,
    endTick,
  });

  for (const { tick, actorId, cell } of moved) {
    cell.actorId = actorId;
    setUnchecked(timeline.ticks, actorId, tick, cell);
  }

  return next;
}

export type CellAnchor = {
  actorId: string;
  tick: number;
};

/** A `rows * ticks` block of sparse cells. */
export type CellBlock = {
  cells: {
    rowOffset: number;
    tickOffset: number;
    cell: Omit<BCFCell, 'actorId'>;
  }[];
  rows: number;
  ticks: number;
};

/**
 * Writes `block` into the document with its first row and tick at `anchor`,
 * overwriting all cells within its extent. An empty block does nothing.
 *
 * @throws Error if the block lands outside the document or on rows whose
 *   actors cannot perform the pasted actions.
 */
export function pasteCells(
  bcf: BlertChartFormat,
  anchor: CellAnchor,
  block: CellBlock,
): BlertChartFormat {
  if (block.rows <= 0 || block.ticks <= 0) {
    return structuredClone(bcf);
  }

  const anchorRow = rowOf(bcf, anchor.actorId);
  assertTick(bcf, anchor.tick);

  const endRow = anchorRow + block.rows - 1;
  assertRow(bcf, endRow);
  const endTick = anchor.tick + block.ticks - 1;
  assertTick(bcf, endTick);

  const order = rows(bcf);

  const placements = block.cells.map(({ rowOffset, tickOffset, cell }) => {
    if (rowOffset < 0 || rowOffset >= block.rows) {
      throw new Error(`Row offset ${rowOffset} is outside the block`);
    }
    if (tickOffset < 0 || tickOffset >= block.ticks) {
      throw new Error(`Tick offset ${tickOffset} is outside the block`);
    }

    const actorId = order[anchorRow + rowOffset];
    const tick = anchor.tick + tickOffset;
    assertCompatibleCell(bcf, actorId, tick, cell);
    return { actorId, tick, cell };
  });

  const next = structuredClone(bcf);
  next.timeline.ticks = clear(next.timeline.ticks, {
    actorIds: order.slice(anchorRow, anchorRow + block.rows),
    startTick: anchor.tick,
    endTick,
  });

  for (const { actorId, tick, cell } of placements) {
    setUnchecked(next.timeline.ticks, actorId, tick, {
      actorId,
      ...structuredClone(cell),
    });
  }

  return next;
}

/**
 * Inserts `count` empty ticks at `atTick`, moving the ticks at and after it
 * later and lengthening the timeline. An `atTick` at the end of the document
 * appends new ticks.
 *
 * @throws Error if `atTick` is outside the document's inclusive bounds.
 */
export function insertTicks(
  bcf: BlertChartFormat,
  atTick: number,
  count: number,
): BlertChartFormat {
  if (count <= 0) {
    return structuredClone(bcf);
  }
  if (atTick < 0 || atTick > bcf.config.totalTicks) {
    throw new Error(
      `Tick ${atTick} is out of bounds [0, ${bcf.config.totalTicks}]`,
    );
  }

  const next = structuredClone(bcf);
  const shift = (tick: number) => (tick >= atTick ? tick + count : tick);

  next.config.totalTicks += count;
  for (const entry of next.timeline.ticks) {
    entry.tick = shift(entry.tick);
  }
  remapTickReferences(next, shift);

  return next;
}

/**
 * Removes `count` ticks starting at `fromTick`, discarding everything within
 * them and moving later ticks earlier.
 *
 * @throws Error if the removed ticks fall outside the document or would leave
 *   the timeline empty.
 */
export function removeTicks(
  bcf: BlertChartFormat,
  fromTick: number,
  count: number,
): BlertChartFormat {
  if (count <= 0) {
    return structuredClone(bcf);
  }

  const { totalTicks } = bcf.config;
  const end = fromTick + count;
  if (fromTick < 0 || end > totalTicks) {
    throw new Error(
      `Ticks [${fromTick}, ${end}) are out of bounds [0, ${totalTicks})`,
    );
  }
  if (count === totalTicks) {
    throw new Error('Cannot remove every tick of the timeline');
  }

  const next = structuredClone(bcf);
  const remap = (tick: number): number | null => {
    if (tick >= end) {
      return tick - count;
    }
    return tick < fromTick ? tick : null;
  };

  next.config.totalTicks -= count;

  const ticks: BCFTick[] = [];
  for (const entry of next.timeline.ticks) {
    const tick = remap(entry.tick);
    if (tick !== null) {
      entry.tick = tick;
      ticks.push(entry);
    }
  }
  next.timeline.ticks = ticks;

  remapTickReferences(next, remap);

  return next;
}

/**
 * Sets the length of the timeline to `totalTicks`, discarding everything
 * beyond it.
 *
 * @throws Error if `totalTicks` is less than one.
 */
export function setTotalTicks(
  bcf: BlertChartFormat,
  totalTicks: number,
): BlertChartFormat {
  if (totalTicks < 1) {
    throw new Error(`A timeline must have at least one tick`);
  }

  const current = bcf.config.totalTicks;
  if (totalTicks < current) {
    return removeTicks(bcf, totalTicks, current - totalTicks);
  }

  const next = structuredClone(bcf);
  next.config.totalTicks = totalTicks;
  return next;
}

/**
 * Updates the metadata of the document.
 * Only the subset of provided fields are modified, with `null` clearing the
 * existing one.
 */
export function updateMeta(
  bcf: BlertChartFormat,
  meta: { name?: string | null; description?: string | null },
): BlertChartFormat {
  const next = structuredClone(bcf);

  if (meta.name !== undefined) {
    if (meta.name === null) {
      delete next.name;
    } else {
      next.name = meta.name;
    }
  }

  if (meta.description !== undefined) {
    if (meta.description === null) {
      delete next.description;
    } else {
      next.description = meta.description;
    }
  }

  return next;
}
