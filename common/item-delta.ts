export type RawItemDelta = number;

export class ItemDelta {
  // An item delta is a 53-bit integer value with the following layout:
  //
  //   Bits 0-30:  Absolute quantity of item added or removed.
  //   Bit 31:     Added bit (1 if the item was added, 0 if it was removed).
  //   Bits 32-48: In-game item ID.
  //   Bits 49-52: ID of the "slot" the item was added to or removed from.
  //               The meaning of slot is context-dependent.
  //
  private static readonly QUANTITY_MASK = BigInt(0x7fffffff);
  private static readonly ADDED_MASK = BigInt(1) << BigInt(31);
  private static readonly ITEM_ID_MASK = BigInt(0xffff);
  private static readonly ITEM_ID_SHIFT = BigInt(32);
  private static readonly SLOT_SHIFT = BigInt(48);
  private static readonly SLOT_MASK = BigInt(0x1f);

  public static fromRaw(raw: RawItemDelta): ItemDelta {
    const rawBigInt = BigInt(raw);
    const quantity = Number(rawBigInt & ItemDelta.QUANTITY_MASK);
    const added = (rawBigInt & ItemDelta.ADDED_MASK) !== BigInt(0);
    const itemId = Number(
      (rawBigInt >> ItemDelta.ITEM_ID_SHIFT) & ItemDelta.ITEM_ID_MASK,
    );
    const slot = Number(
      (rawBigInt >> ItemDelta.SLOT_SHIFT) & ItemDelta.SLOT_MASK,
    );
    return new ItemDelta(itemId, quantity, slot, added);
  }

  public constructor(
    private readonly itemId: number,
    private readonly quantity: number,
    private readonly slot: number,
    private readonly added: boolean,
  ) {}

  public getItemId(): number {
    return this.itemId;
  }

  public getQuantity(): number {
    return this.quantity;
  }

  public getSlot(): number {
    return this.slot;
  }

  public isAdded(): boolean {
    return this.added;
  }

  public toString(): string {
    return `${this.added ? '+' : '-'}${this.quantity}x${this.itemId}@${this.slot}`;
  }

  public toRaw(): RawItemDelta {
    let raw = BigInt(this.quantity) & ItemDelta.QUANTITY_MASK;
    if (this.added) {
      raw |= ItemDelta.ADDED_MASK;
    }
    raw |=
      (BigInt(this.itemId) & ItemDelta.ITEM_ID_MASK) << ItemDelta.ITEM_ID_SHIFT;
    raw |= (BigInt(this.slot) & ItemDelta.SLOT_MASK) << ItemDelta.SLOT_SHIFT;

    return Number(raw);
  }
}

/** An item occupying a single container slot. */
export type ItemStack = { id: number; quantity: number };

/**
 * Applies a list of raw item deltas on top of a previous container and returns
 * the resulting container.
 *
 * Containers are sparse maps of slot keys to items, with either `null` or a
 * nonexistent entry representing an empty slot.
 *
 * @param deltas The list of item deltas to apply.
 * @param previous The previous container to start from, or `null` to start from
 *   an empty container.
 * @returns The resulting container.
 */
export function applyItemDeltas(
  deltas: RawItemDelta[],
  previous: Record<number, ItemStack | null> | null,
): Record<number, ItemStack>;

/**
 * Applies a list of raw item deltas on top of a previous container and returns
 * the resulting container.
 *
 * Containers are sparse maps of slot keys to items, with either `null` or a
 * nonexistent entry representing an empty slot.
 *
 * @param deltas The list of item deltas to apply.
 * @param previous The previous container to start from, or `null` to start from
 *   an empty container.
 * @param createItem Function to create an item object from an ID and quantity.
 * @returns The resulting container.
 */
export function applyItemDeltas<T extends ItemStack>(
  deltas: RawItemDelta[],
  previous: Record<number, T | null> | null,
  createItem: (id: number, quantity: number) => T,
): Record<number, T>;

export function applyItemDeltas<T extends ItemStack>(
  deltas: RawItemDelta[],
  previous: Record<number, T | null> | null,
  createItem: (id: number, quantity: number) => T = (id, quantity) =>
    ({ id, quantity }) as T,
): Record<number, T> {
  const container: Record<number, T> = {};
  if (previous !== null) {
    for (const key of Object.keys(previous)) {
      const item = previous[Number(key)];
      if (item !== null) {
        container[Number(key)] = item;
      }
    }
  }

  for (const raw of deltas) {
    const delta = ItemDelta.fromRaw(raw);
    const slot = delta.getSlot();
    const current = container[slot] ?? null;

    if (delta.isAdded()) {
      if (current?.id !== delta.getItemId()) {
        container[slot] = createItem(delta.getItemId(), delta.getQuantity());
      } else {
        container[slot] = createItem(
          delta.getItemId(),
          current.quantity + delta.getQuantity(),
        );
      }
    } else if (
      current !== null &&
      current.id === delta.getItemId() &&
      delta.getQuantity() < current.quantity
    ) {
      container[slot] = createItem(
        delta.getItemId(),
        current.quantity - delta.getQuantity(),
      );
    } else {
      delete container[slot];
    }
  }

  return container;
}
