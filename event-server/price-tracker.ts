type WikiLatestPriceResponse = {
  data: {
    [id: string]: {
      high: number;
      highTime: number;
      low: number;
      lowTime: number;
    };
  };
};

const OSRS_WIKI_PRICES_ENDPOINT = 'https://prices.runescape.wiki/api/v1/osrs';
const ONE_HOUR_MS = 60 * 60 * 1000;

type CachedPrice = {
  price: number;
  expiry: number;
};

class PriceTracker {
  private priceCache: Map<number, CachedPrice>;

  constructor() {
    this.priceCache = new Map();
  }

  /**
   * Returns the current Grand Exchange price of an item.
   *
   * @param itemId ID of the item to query.
   * @returns The item's price.
   * @throws An error if the price could not be obtained.
   */
  public async getPrice(itemId: number): Promise<number> {
    const timestamp = Date.now();

    const cachedPrice = this.priceCache.get(itemId);
    if (cachedPrice !== undefined && timestamp < cachedPrice.expiry) {
      return cachedPrice.price;
    }

    const price = await this.fetchPrice(itemId);
    const expiry = timestamp + ONE_HOUR_MS;
    this.priceCache.set(itemId, { price, expiry });

    return price;
  }

  private async fetchPrice(itemId: number): Promise<number> {
    const uri = `${OSRS_WIKI_PRICES_ENDPOINT}/latest?id=${itemId}`;

    let priceJson: WikiLatestPriceResponse;
    try {
      const response = await fetch(uri, {
        headers: { 'User-Agent': 'blert.io server' },
      });
      priceJson = (await response.json()) as WikiLatestPriceResponse;
    } catch (e) {
      throw new Error(`Failed to fetch price data: ${e}`);
    }

    const dataForItem = priceJson.data[itemId];
    if (dataForItem === undefined) {
      throw new Error(`Invalid API response`);
    }

    const averagePrice = (dataForItem.low + dataForItem.high) / 2;
    return Math.floor(averagePrice);
  }
}

export const priceTracker = new PriceTracker();
