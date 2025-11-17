export interface ItemData {
  id: number;
  name: string;
}

export class ItemCache<T extends ItemData> {
  protected cache: Map<number, T>;

  private itemsToFetch: Set<number>;
  private fetchTimeout: NodeJS.Timeout | null;

  public constructor() {
    this.cache = new Map();
    this.itemsToFetch = new Set();
    this.fetchTimeout = null;
  }

  /**
   * Adds items to the cache.
   * @param items List of items to insert.
   */
  public populate(items: T[]): void {
    for (const item of items) {
      this.cache.set(item.id, item);
    }
  }

  /**
   * Looks up the name of an item by its ID.
   * @param id RuneScape item ID.
   * @returns The name of the item, or 'Unknown item' if not found.
   */
  public getItemName(id: number): string {
    if (!this.cache.has(id)) {
      this.itemsToFetch.add(id);

      this.fetchTimeout ??= setTimeout(() => {
        void (async () => {
          this.fetchTimeout = null;
          await this.fetchMissingItems();
        })();
      }, 1000);
    }
    return this.cache.get(id)?.name ?? 'Unknown item';
  }

  private async fetchMissingItems(): Promise<void> {
    const promises = Array.from(this.itemsToFetch).map((id) =>
      this.fetchItemName(id),
    );
    this.itemsToFetch.clear();
    await Promise.all(promises);
  }

  private async fetchItemName(id: number): Promise<void> {
    // TODO(frolv): Get items from the OSRS Wiki API.
    throw new Error(`Cannot fetch item ${id}: Not implemented`);
    await Promise.resolve();
  }
}
