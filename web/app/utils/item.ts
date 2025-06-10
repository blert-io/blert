const COSMETIC_TO_BASE_ID: Record<number, number> = {
  [19720]: 12002, // Occult necklace (or)
  [20366]: 19553, // Amulet of torture (or)
  [20368]: 11802, // Armadyl godsword (or)
  [20370]: 11804, // Bandos godsword (or)
  [20372]: 11806, // Saradomin godsword (or)
  [20374]: 11808, // Zamorak godsword (or)
  [22249]: 19547, // Necklace of anguish (or)
  [23444]: 19544, // Tormented bracelet (or)
  [24664]: 21018, // Twisted ancestral hat
  [24666]: 21021, // Twisted ancestral robe top
  [24668]: 21024, // Twisted ancestral robe bottom
  [25731]: 22323, // Holy sanguinesti staff
  [25734]: 22324, // Holy ghrazi rapier
  [25736]: 22325, // Holy scythe of vitur
  [25739]: 22325, // Sanguine scythe of vitur
  [26469]: 13072, // Elite void top (or)
  [26471]: 13073, // Elite void bottom (or)
  [26473]: 11663, // Void mage helm (or)
  [26475]: 11664, // Void ranger helm (or)
  [26477]: 11665, // Void melee helm (or)
  [26484]: 12006, // Abyssal tentacle (or)
  [27100]: 21003, // Elder maul (or)
  [27246]: 26219, // Osmumten's fang (or)
  [27253]: 27251, // Elidinis' ward (or)
  [28039]: 13652, // Dragon claws (cr)
  [28254]: 26382, // Sanguine torva full helm
  [28256]: 26384, // Sanguine torva platebody
  [28258]: 26386, // Sanguine torva platelegs
  [28682]: 21015, // Dinh's blazing bulwark
  [28688]: 12926, // Blazing blowpipe
  [29602]: 24424, // Corrupted volatile nightmare staff
  [29609]: 24424, // Volatile nightmare staff (deadman)
  [29804]: 29801, // Amulet of rancour (s)
  [30434]: 27610, // Echo venator bow
  [30777]: 30750, // Radiant oathplate helm
  [30779]: 30753, // Radiant oathplate chest
  [30781]: 30756, // Radiant oathplate legs
};

/**
 * Returns the "base" ID for an item, ignoring variations such as cosmetic
 * overrides.
 * @param itemId The ID of the item to normalize.
 * @returns The normalized item ID.
 */
export function normalizeItemId(itemId: number): number {
  return COSMETIC_TO_BASE_ID[itemId] ?? itemId;
}
