import { EquipmentSlot } from '@blert/common';

import { ItemCache, ItemData } from './cache';

export interface ExtendedItemData extends ItemData {
  equipable: boolean;
  stackable: boolean;
  tradeable: boolean;
  bankNote: boolean;
  weight: number;
  slot?: EquipmentSlot;
  stats?: EquipmentStats;
}

export type EquipmentStats = {
  stabAttack: number;
  slashAttack: number;
  crushAttack: number;
  magicAttack: number;
  rangedAttack: number;
  stabDefence: number;
  slashDefence: number;
  crushDefence: number;
  magicDefence: number;
  rangedDefence: number;
  meleeStrength: number;
  rangedStrength: number;
  magicDamage: number;
  prayer: number;
  attackSpeed: number;
  twoHanded: boolean;
};

// Common American -> British spelling mappings
const SPELLING_VARIANTS: Record<string, string> = {
  armor: 'armour',
  color: 'colour',
  defense: 'defence',
  honor: 'honour',
  humor: 'humour',
  labor: 'labour',
  scepter: 'sceptre',
  sulfur: 'sulphur',
  rancor: 'rancour',
  rigor: 'rigour',
  rumor: 'rumour',
  vigor: 'vigour',
};

type SearchResult = {
  item: ExtendedItemData;
  priority: number;
};

const MAX_PERMITTED_USER_PRIORITY = 1000;

export class ExtendedItemCache extends ItemCache<ExtendedItemData> {
  private readonly allowBankNotes: boolean;

  private slotIndex = new Map<EquipmentSlot, Set<number>>();
  private normalizedIndex = new Map<string, Set<number>>();
  private aliasIndex = new Map<string, number[]>();

  private itemPriorities = new Map<number, number>();

  private fuzzyMatchBasePriority: number = 0;
  private exactMatchBasePriority: number = 0;
  private aliasExactMatchPriority: number = 0;

  public constructor(allowBankNotes: boolean = false) {
    super();
    this.allowBankNotes = allowBankNotes;
  }

  public getItem(id: number): ExtendedItemData | null {
    return this.cache.get(id) ?? null;
  }

  /**
   * Populates the item cache with items and optional user-defined priorities.
   * @param items Items with which to populate the cache.
   * @param userPriorities User-defined priorities for sorting items,
   *   ranging from 0 to 1000.
   * @param aliases Aliases for items, mapped to their item IDs.
   */
  public populate(
    items: ExtendedItemData[],
    userPriorities: Record<number, number> = {},
    aliases: Record<string, number | number[]> = {},
  ): void {
    const filteredItems = items.filter((item) => {
      if (!this.allowBankNotes && item.bankNote) {
        return false;
      }

      const ignoredSuffixes = ['(l)', '(broken)', '(deadman)', '(nz)'];
      if (ignoredSuffixes.some((suffix) => item.name.includes(suffix))) {
        return false;
      }

      return true;
    });

    super.populate(filteredItems);
    this.buildSearchIndex(filteredItems);
    this.buildAliasIndex(aliases);

    let maxUserPriority = 0;
    for (const [id, priority] of Object.entries(userPriorities)) {
      if (priority > MAX_PERMITTED_USER_PRIORITY) {
        throw new Error(
          `User priority for item ${id} is too high: ${priority}`,
        );
      }

      const item = this.getItem(parseInt(id));
      if (item) {
        this.itemPriorities.set(item.id, priority);
        maxUserPriority = Math.max(maxUserPriority, priority);
      }
    }

    // Pseudo-priorities used for exact and alias matches to ensure they appear
    // before fuzzy matches.
    this.fuzzyMatchBasePriority = maxUserPriority + 10_000;
    this.exactMatchBasePriority = maxUserPriority + 100_000;
    this.aliasExactMatchPriority = maxUserPriority + 1_000_000;
  }

  private buildAliasIndex(aliases: Record<string, number | number[]>): void {
    this.aliasIndex = new Map(
      Object.entries(aliases).map(([key, value]) => [
        key,
        Array.isArray(value) ? value : [value],
      ]),
    );
  }

  private normalizeWord(word: string): string {
    word = word.toLowerCase().replace(/[^a-z0-9]/g, '');
    return SPELLING_VARIANTS[word] || word;
  }

  private buildSearchIndex(items: ExtendedItemData[]): void {
    this.slotIndex.clear();
    this.normalizedIndex.clear();

    for (const item of items) {
      // Index each word in the item name.
      const words = item.name.toLowerCase().split(/[^a-z0-9]+/);
      for (const word of words) {
        if (!word) {
          // Skip empty strings from consecutive delimiters.
          continue;
        }

        const normalized = this.normalizeWord(word);
        const normalizedSet = this.normalizedIndex.get(normalized) ?? new Set();
        normalizedSet.add(item.id);
        this.normalizedIndex.set(normalized, normalizedSet);
      }

      // Index by equipment slot
      if (item.slot !== undefined) {
        const slotSet = this.slotIndex.get(item.slot) ?? new Set();
        slotSet.add(item.id);
        this.slotIndex.set(item.slot, slotSet);

        // Also add the slot name to the search index.
        const slotName = EquipmentSlot[item.slot]?.toLowerCase();
        if (slotName) {
          const normalizedSet = this.normalizedIndex.get(slotName) ?? new Set();
          normalizedSet.add(item.id);
          this.normalizedIndex.set(slotName, normalizedSet);
        }
      }
    }
  }

  /**
   * Searches for items by name, optionally filtered by equipment slot.
   * @param query The search query
   * @param slot Optional equipment slot to filter by
   * @param limit Maximum number of results to return
   * @param predicate Optional predicate to filter items by
   * @returns Array of matching items
   */
  public search(
    query: string,
    slot?: EquipmentSlot,
    limit: number = 50,
    predicate?: (item: ExtendedItemData) => boolean,
  ): ExtendedItemData[] {
    const words = query
      .toLowerCase()
      .trim()
      .split(/[^a-z0-9]+/)
      .filter((w) => w);
    let results: Map<number, SearchResult>;

    if (words.length === 0) {
      // For empty queries with a slot filter, return all items in that slot.
      if (slot !== undefined) {
        const slotItems = this.slotIndex.get(slot);
        results = slotItems
          ? new Map(
              Array.from(slotItems.values()).map((id) => [
                id,
                {
                  item: this.getItem(id)!,
                  priority: this.itemPriorities.get(id) ?? 0,
                },
              ]),
            )
          : new Map<number, SearchResult>();
      } else {
        return [];
      }
    } else {
      // Find items that match each word in the query, then intersect the
      // results to find items that match all words.
      const matchingSets = words.map((word) => this.findMatches(word));

      results = matchingSets[0];
      for (let i = 1; i < matchingSets.length; i++) {
        const currentMatches = matchingSets[i];
        for (const [id, result] of results.entries()) {
          const matchingResult = currentMatches.get(id);
          if (matchingResult) {
            results.set(id, {
              ...result,
              priority: result.priority + matchingResult.priority,
            });
          } else {
            results.delete(id);
          }
        }
      }

      // Filter by slot if specified.
      if (slot !== undefined) {
        const slotItems = this.slotIndex.get(slot);
        if (slotItems) {
          for (const id of results.keys()) {
            if (!slotItems.has(id)) {
              results.delete(id);
            }
          }
        } else {
          return [];
        }
      }
    }

    if (predicate !== undefined) {
      for (const [id, result] of results.entries()) {
        if (!predicate(result.item)) {
          results.delete(id);
        }
      }
    }

    // Sort by priority (high to low), then alphabetically.
    return Array.from(results.values())
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }

        // If both items have a quantity suffix, sort by descending quantity.
        if (/\(\d+\)$/.test(a.item.name) && /\(\d+\)$/.test(b.item.name)) {
          return b.item.name.localeCompare(a.item.name);
        }

        return a.item.name.localeCompare(b.item.name);
      })
      .slice(0, limit)
      .map((result) => result.item);
  }

  private findMatches(word: string): Map<number, SearchResult> {
    const matches = new Map<number, SearchResult>();

    // First, try exact alias match with the original word (before
    // normalization) to handle special characters.
    const lowercaseWord = word.toLowerCase();
    for (const [alias, itemIds] of this.aliasIndex.entries()) {
      if (alias === lowercaseWord) {
        // If the search term exactly matches an alias, set their priorities to
        // above the normal item priority to ensure it appears first. These are
        // set in descending order so that the items appear in the order defined
        // in ITEM_ALIASES.
        for (let i = 0; i < itemIds.length; i++) {
          const priority = this.aliasExactMatchPriority + itemIds.length - i;
          const item = this.getItem(itemIds[i]);
          if (item !== null) {
            matches.set(itemIds[i], { item, priority });
          }
        }
      }
    }

    const normalized = this.normalizeWord(word);

    // Then, check for partial alias matches with normalized word.
    for (const [alias, itemIds] of this.aliasIndex.entries()) {
      const aliasNormalized = this.normalizeWord(alias);
      if (aliasNormalized.startsWith(normalized)) {
        const distance = aliasNormalized.length - normalized.length;
        const basePriority = this.fuzzyMatchBasePriority * 2 - distance;

        for (const itemId of itemIds) {
          const item = this.getItem(itemId);
          if (item !== null && !matches.has(itemId)) {
            matches.set(itemId, {
              item,
              priority: basePriority + (this.itemPriorities.get(itemId) ?? 0),
            });
          }
        }
      }
    }

    // Try exact matches with normalized spelling.
    for (const [indexWord, ids] of this.normalizedIndex.entries()) {
      if (indexWord === normalized || indexWord.startsWith(normalized)) {
        for (const id of ids) {
          const item = this.getItem(id);
          if (item !== null && !matches.has(id)) {
            matches.set(id, {
              item,
              priority:
                this.exactMatchBasePriority +
                (this.itemPriorities.get(id) ?? 0) +
                this.slotPenalty(item, normalized),
            });
          }
        }
      }
    }

    // Otherwise, try fuzzy matching.
    const MAX_DISTANCE = Math.min(3, Math.floor(normalized.length / 3));
    for (const [indexWord, ids] of this.normalizedIndex.entries()) {
      const distance = this.levenshteinDistance(normalized, indexWord);
      const isTransposed = this.hasTransposedCharacters(normalized, indexWord);

      if (distance <= MAX_DISTANCE || isTransposed) {
        let basePriority = this.fuzzyMatchBasePriority;
        if (!isTransposed) {
          basePriority -= distance;
        }

        for (const id of ids) {
          const item = this.getItem(id);
          if (item !== null) {
            const existing = matches.get(id);
            const priority =
              basePriority +
              (this.itemPriorities.get(id) ?? 0) +
              this.slotPenalty(item, normalized);
            if (!existing || existing.priority < priority) {
              matches.set(id, { item, priority });
            }
          }
        }
      }
    }

    return matches;
  }

  /**
   * Calculates the Levenshtein distance between two strings.
   * @param a First string
   * @param b Second string
   * @returns Edit distance between the strings
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) {
      return b.length;
    }

    if (b.length === 0) {
      return a.length;
    }

    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1,
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  private hasTransposedCharacters(a: string, b: string): boolean {
    if (Math.abs(a.length - b.length) > 1) {
      return false;
    }

    const chars = new Map<string, number>();
    for (const c of a) {
      chars.set(c, (chars.get(c) ?? 0) + 1);
    }
    for (const c of b) {
      const count = chars.get(c) ?? 0;
      if (count === 0) {
        return false;
      }
      chars.set(c, count - 1);
    }

    return Array.from(chars.values()).every((count) => count === 0);
  }

  /**
   * Checks if a query fuzzy matches a slot name, and applies a penalty if
   * the item name does not contain the slot name.
   *
   * This ensures that items which contain the name of a slot are ranked higher
   * than generic items for that slot on a slot-based query.
   *
   * @param item Item to check.
   * @param normalizedQuery Normalized query.
   * @returns Item priority penalty to apply.
   */
  private slotPenalty(item: ExtendedItemData, normalizedQuery: string): number {
    const slotName = Object.keys(EquipmentSlot).find(
      (slot) =>
        this.levenshteinDistance(slot.toLowerCase(), normalizedQuery) <= 2,
    );
    if (!slotName) {
      return 0;
    }

    const nameContainsSlot = item.name
      .toLowerCase()
      .includes(slotName.toLowerCase());
    return !nameContainsSlot ? -5 : 0;
  }
}

// Manual priority list for commonly searched items.
const DEFAULT_ITEM_PRIORITIES: Record<number, number> = {
  // Ancestral robes
  21018: 1,
  21021: 1,
  21024: 1,

  // Bandos armor and godsword
  11832: 1,
  11834: 1,
  11836: 1,
  11804: 1,

  // Bellator, magus, venator, and ultor rings
  28316: 1,
  28313: 1,
  28310: 1,
  28307: 1,

  // Book of the dead
  25818: 1,

  // Barrows and ferocious gloves
  7462: 1,
  22981: 1,

  // Chinchompas (all flavors)
  9976: 1,
  10034: 1,
  11959: 1,

  // Dragon claws
  13652: 1,

  // Dragon warhammer
  13576: 1,

  // Elder maul
  21003: 1,

  // Fighter torso
  10551: 1,

  // Imbued and saturated heart
  20724: 1,
  27641: 1,

  // Infernal cape
  21295: 1,

  // Kodai wand
  21006: 1,

  // Lightbearer
  25975: 1,

  // Masori armor
  27235: 1,
  27238: 1,
  27241: 1,

  // Oathplate armor
  30750: 1,
  30753: 1,
  30756: 1,

  // Occult necklace
  12002: 1,

  // Osmumten's fang
  26219: 1,

  // Primordial, pegasian, and eternal boots
  13235: 1,
  13237: 1,
  13239: 1,

  // Runes.
  554: 1,
  555: 1,
  556: 1,
  557: 1,
  558: 1,
  562: 1,
  560: 1,
  565: 1,
  21880: 1,
  559: 1,
  564: 1,
  561: 1,
  563: 1,
  566: 1,
  9075: 1,
  4694: 1,
  4695: 1,
  4696: 1,
  4697: 1,
  4698: 1,
  4699: 1,
  28929: 1,
  30843: 1,

  // Rune pouches
  12791: 1,
  27281: 1,

  // Salve amulet (ei?)
  10588: 1,
  12018: 1,

  // Saradomin brew
  6685: 1,
  6687: 1,
  6689: 1,
  6691: 1,

  // Soulflame horn
  30759: 1,

  // Scythe of vitur
  22325: 1,

  // Sulphur blades
  29084: 1,

  // Swift blade
  24219: 1,

  // Toxic blowpipe
  12926: 1,

  // Tumeken's shadow
  27275: 1,

  // Twisted bow
  20997: 1,

  // Twisted buckler
  21000: 1,

  // Regular and sanguine Torva
  28254: 1,
  28256: 1,
  28258: 1,
  26382: 1,
  26384: 1,
  26386: 1,

  // Virtus robes
  26241: 1,
  26243: 1,
  26245: 1,
};

// Common item nicknames/aliases mapped to their item IDs.
const DEFAULT_ITEM_ALIASES: Record<string, number | number[]> = {
  // Abyssal whip
  whip: 4151,

  // Amulet of rancour (s)
  cumulet: 29804,
  rancum: 29804,

  // Ancestral robes
  ancy: [21018, 21021, 21024],

  // Armadyl godsword
  ags: 11802,

  // Bandos godsword
  bgs: 11804,

  // Blood fury
  bf: 24780,

  // Blood moon armor
  fursuit: [29047, 29043, 29045, 28997],

  // Book of the dead
  'thrall book': 25818,
  thrall: 25818,

  // Chugging barrel
  jug: 30000,

  // Crystal halberd
  chally: 23987,

  // Dinh's bulwark
  door: 21015,

  // Dragon dagger (all poison variations, decreasing severity)
  dds: [5698, 5680, 1231, 1215],

  // Dual macuahuitl
  macs: 28997,
  macaroni: 28997,
  maracas: 28997,
  boppers: 28997,

  // Items used for humidify Bloat.
  humid: [11090, 12695, 6685, 4417, 9075, 555, 4699, 4694, 4695],

  // Ghommal's lucky penny
  coin: 27544,

  // Godbooks
  godbook: [12612, 12608, 12610, 3840, 3842, 3844],
  gb: [12612, 12608, 12610, 3840, 3842, 3844],

  // Guthix rest (all doses)
  tea: [4417, 4419, 4421, 4423],

  // Keris partisan of corruption
  'red keris': 27287,

  // Keris partisan of breaching
  'blue keris': 25981,

  // Keris partisan of the sun
  'yellow keris': 27291,

  // Kodai wand
  plug: 21006,
  buttplug: 21006,

  // Lightbearer
  lb: 25975,

  // Nature runes
  nats: 561,

  // Pegasian boots
  pegs: 13237,

  // Phoenix necklace
  neck: 11090,
  pneck: 11090,
  caps: 11090,

  // Sanguine and regular Torva
  blorva: [28254, 28256, 28258, 26382, 26384, 26386],

  // Sanguinesti staff
  sang: 22323,

  // Salve amulet (ei)
  'blue salve': 12018,

  // Saradomin godsword
  sgs: 11806,

  // Saturated heart should appear when searching for imbued heart
  imbued: 27641,

  // Staff of the dead (and toxic staff of the dead)
  sotd: [11791, 12904],

  // Super combat (all doses + divine)
  scb: [12695, 12697, 12699, 12701, 23685, 23688, 23691, 23694],

  // Tonaliztics of Ralos
  glaive: 28922,
  star: 28922,

  // Toxic blowpipe
  bp: 12926,
  pipe: 12926,

  // Toxic staff of the dead (and regular staff of the dead)
  tsotd: [12904, 11791],

  // Twisted bow
  tbow: 20997,

  // Don't ask.
  twink: [2150, 2875, 6089, 6090, 6091, 6092, 7564, 2152, 2154, 2156],

  // Venator bow
  venny: 27610,
  vbow: 27610,

  // Voidwaker
  vw: 27690,
  korasi: 27690,

  // Volatile nightmare staff
  voli: 24424,

  // Zamorak godsword
  zgs: 11080,

  // Zaryte crossbow
  zcb: 26374,
  zbow: 26374,
};

// There are a bunch of random duplicate items (thanks Jagex). Try to filter
// some of them out. Also get rid some some seasonal gamemode items.
// This list is far from exhaustive, but it should catch junk that comes up in
// the most common item searches.
const EXCLUDED_ITEMS = new Set([
  27186, 6424, 7556, 11687, 6428, 7554, 11686, 6422, 7558, 11688, 6426, 11689,
  6436, 11690, 6430, 7560, 11694, 6432, 11692, 11697, 22208, 6438, 11691, 11696,
  11693, 6434, 11695, 11698, 11699, 25490, 25489, 25492, 25491, 20593, 22665,
  20782, 21060, 30303, 30304, 30302, 23626, 28540, 28537, 29599, 28534, 22644,
  28543, 28545, 25488, 25486, 25485, 25487, 24125, 28516, 28517, 29663, 29664,
  26131, 26132, 28492, 28493, 29678, 29679, 26008, 26009, 20784, 21205, 10033,
  9977, 23543, 23545, 23547, 23549, 21284, 21296, 21297, 23622, 27870, 28507,
  28508, 25518, 27194, 27193, 27173, 26110, 26111, 27172, 27171, 25278, 26782,
  25250, 26763, 23654, 28547, 28549, 26237, 26239, 20389, 23609, 23607, 23603,
  23605, 23650, 27086, 23551, 23553, 23555, 23557, 23575, 23577, 23579, 23581,
  23567, 23569, 23571, 23573, 23559, 23561, 23563, 23565, 23628, 25517, 10516,
  10517, 10518, 10519, 10520, 31132, 31133,
]);

import itemDump from '../../../resources/extended_items.json';

const defaultCache = new ExtendedItemCache();
defaultCache.populate(
  (itemDump as ExtendedItemData[]).filter(
    (item) => !EXCLUDED_ITEMS.has(item.id),
  ),
  DEFAULT_ITEM_PRIORITIES,
  DEFAULT_ITEM_ALIASES,
);

export const extendedItemCache = defaultCache;
