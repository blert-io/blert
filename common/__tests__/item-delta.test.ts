import { ItemDelta, ItemStack, applyItemDeltas } from '../item-delta';

function deltas(
  ...entries: [id: number, quantity: number, slot: number, added: boolean][]
): number[] {
  return entries.map(([id, quantity, slot, added]) =>
    new ItemDelta(id, quantity, slot, added).toRaw(),
  );
}

describe('applyItemDeltas', () => {
  it('builds a container from scratch when previous is null', () => {
    const result = applyItemDeltas(
      deltas([100, 1, 0, true], [200, 1, 4, true]),
      null,
    );
    expect(result).toEqual({
      0: { id: 100, quantity: 1 },
      4: { id: 200, quantity: 1 },
    });
  });

  it('carries unchanged slots forward and adds new ones', () => {
    const result = applyItemDeltas(deltas([200, 1, 4, true]), {
      0: { id: 100, quantity: 1 },
    });
    expect(result).toEqual({
      0: { id: 100, quantity: 1 },
      4: { id: 200, quantity: 1 },
    });
  });

  it('increments the quantity when the same item is added to a slot', () => {
    const result = applyItemDeltas(deltas([50, 3, 3, true]), {
      3: { id: 50, quantity: 5 },
    });
    expect(result).toEqual({ 3: { id: 50, quantity: 8 } });
  });

  it('replaces the slot when a different item is added', () => {
    const result = applyItemDeltas(deltas([200, 1, 4, true]), {
      4: { id: 100, quantity: 1 },
    });
    expect(result).toEqual({ 4: { id: 200, quantity: 1 } });
  });

  it('reduces the quantity on a partial removal', () => {
    const result = applyItemDeltas(deltas([50, 2, 3, false]), {
      3: { id: 50, quantity: 5 },
    });
    expect(result).toEqual({ 3: { id: 50, quantity: 3 } });
  });

  it('clears the slot when the full quantity is removed', () => {
    const result = applyItemDeltas(deltas([100, 1, 0, false]), {
      0: { id: 100, quantity: 1 },
    });
    expect(result).toEqual({});
    expect(0 in result).toBe(false);
  });

  it('clears the slot when a removal targets a different item id', () => {
    const result = applyItemDeltas(deltas([999, 1, 0, false]), {
      0: { id: 100, quantity: 1 },
    });
    expect(result).toEqual({});
  });

  it('treats null and absent slots in previous as empty', () => {
    const result = applyItemDeltas(deltas([100, 1, 0, true]), {
      0: null,
      4: { id: 200, quantity: 1 },
    });
    expect(result).toEqual({
      0: { id: 100, quantity: 1 },
      4: { id: 200, quantity: 1 },
    });
  });

  it('does not mutate the previous container', () => {
    const previous: Record<number, ItemStack | null> = {
      0: { id: 100, quantity: 1 },
      3: { id: 50, quantity: 5 },
    };
    applyItemDeltas(deltas([50, 2, 3, false], [200, 1, 4, true]), previous);
    expect(previous).toEqual({
      0: { id: 100, quantity: 1 },
      3: { id: 50, quantity: 5 },
    });
  });

  it('uses the item factory to enrich items', () => {
    const result = applyItemDeltas(
      deltas([100, 2, 0, true]),
      null,
      (id, quantity) => ({ id, quantity, name: `item-${id}` }),
    );
    expect(result).toEqual({ 0: { id: 100, quantity: 2, name: 'item-100' } });
  });
});
