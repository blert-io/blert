import { ItemCache, ItemData } from './cache';

import itemDump from '../../../resources/simple_items.json';

const defaultCache = new ItemCache<ItemData>();
defaultCache.populate(itemDump);

export const simpleItemCache = defaultCache;
