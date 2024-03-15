type FileItem = {
  id: number;
  name: string;
};

export class ItemCache {
  private cache: Map<number, string>;

  private itemsToFetch: number[];
  private fetchTimeout: NodeJS.Timeout | null;

  public constructor() {
    this.cache = new Map();
    this.itemsToFetch = [];
    this.fetchTimeout = null;
  }

  /**
   * Adds items to the cache.
   * @param items List of items to insert.
   */
  public populate(items: FileItem[]): void {
    for (const item of items) {
      this.cache.set(item.id, item.name);
    }
  }

  /**
   * Looks up the name of an item by its ID.
   * @param id RuneScape item ID.
   * @returns The name of the item, or 'Unknown item' if not found.
   */
  public getItemName(id: number): string {
    if (!this.cache.has(id)) {
      this.itemsToFetch.push(id);

      if (this.fetchTimeout === null) {
        this.fetchTimeout = setTimeout(async () => {
          this.fetchTimeout = null;
          await this.fetchMissingItems();
        }, 1000);
      }
    }
    return this.cache.get(id) ?? 'Unknown item';
  }

  private async fetchMissingItems(): Promise<void> {
    const promises = this.itemsToFetch.map(this.fetchItemName);
    this.itemsToFetch = [];
    await Promise.all(promises);
  }

  private async fetchItemName(id: number): Promise<void> {
    // TODO(frolv): Get items from the OSRS Wiki API.
    throw new Error('Not implemented');
  }
}

import itemDump from '../../resources/runescape_items.json';

const defaultCache = new ItemCache();
defaultCache.populate(itemDump);

export const defaultItemCache = defaultCache;
