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
