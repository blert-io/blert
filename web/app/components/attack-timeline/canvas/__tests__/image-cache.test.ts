import { ImageCache } from '../image-cache';

let mockImages: {
  src: string;
  crossOrigin: string | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}[];

beforeEach(() => {
  mockImages = [];

  // @ts-expect-error mocking for testing
  global.Image = class MockImage {
    src = '';
    crossOrigin: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor() {
      mockImages.push(this);
    }
  };
});

function lastMockImage() {
  return mockImages[mockImages.length - 1];
}

describe('ImageCache', () => {
  describe('get()', () => {
    it('returns undefined for an unseen URL and starts loading', () => {
      const cache = new ImageCache(() => {
        /* no-op */
      });
      const result = cache.get('/images/combat/skull.webp');
      expect(result).toBeUndefined();
      expect(mockImages).toHaveLength(1);
      expect(lastMockImage().src).toBe('/images/combat/skull.webp');
    });

    it('returns the image after it has loaded', () => {
      const cache = new ImageCache(() => {
        /* no-op */
      });
      cache.get('/images/combat/skull.webp');

      lastMockImage().onload!();

      const result = cache.get('/images/combat/skull.webp');
      expect(result).toBeDefined();
      expect(result).toBe(lastMockImage());
    });

    it('returns undefined after load error', () => {
      const cache = new ImageCache(() => {
        /* no-op */
      });
      cache.get('/images/combat/skull.webp');

      lastMockImage().onerror!();

      const result = cache.get('/images/combat/skull.webp');
      expect(result).toBeUndefined();
    });

    it('does not create a second image for the same URL', () => {
      const cache = new ImageCache(() => {
        /* no-op */
      });
      cache.get('/images/combat/skull.webp');
      cache.get('/images/combat/skull.webp');
      expect(mockImages).toHaveLength(1);
    });
  });

  describe('onLoad callback', () => {
    it('fires the onLoad callback when an image loads', () => {
      const onLoad = jest.fn();
      const cache = new ImageCache(onLoad);
      cache.get('/images/combat/skull.webp');

      expect(onLoad).not.toHaveBeenCalled();
      lastMockImage().onload!();
      expect(onLoad).toHaveBeenCalledWith('/images/combat/skull.webp');
    });

    it('does not fire onLoad on error', () => {
      const onLoad = jest.fn();
      const cache = new ImageCache(onLoad);
      cache.get('/images/combat/skull.webp');

      lastMockImage().onerror!();
      expect(onLoad).not.toHaveBeenCalled();
    });
  });

  describe('crossOrigin', () => {
    it('sets crossOrigin for external URLs', () => {
      const cache = new ImageCache(() => {
        /* no-op */
      });
      cache.get('https://chisel.weirdgloop.org/static/img/osrs-sprite/123.png');
      expect(lastMockImage().crossOrigin).toBe('anonymous');
    });

    it('does not set crossOrigin for local URLs', () => {
      const cache = new ImageCache(() => {
        /* no-op */
      });
      cache.get('/images/combat/skull.webp');
      expect(lastMockImage().crossOrigin).toBeNull();
    });
  });

  describe('preload()', () => {
    it('starts loading without returning a value', () => {
      const cache = new ImageCache(() => {
        /* no-op */
      });
      cache.preload('/images/combat/spec.png');
      expect(mockImages).toHaveLength(1);
      expect(lastMockImage().src).toBe('/images/combat/spec.png');
    });

    it('does not load the same URL twice', () => {
      const cache = new ImageCache(() => {
        /* no-op */
      });
      cache.preload('/images/combat/spec.png');
      cache.preload('/images/combat/spec.png');
      expect(mockImages).toHaveLength(1);
    });

    it('shares state with get()', () => {
      const cache = new ImageCache(() => {
        /* no-op */
      });
      cache.preload('/images/combat/spec.png');
      lastMockImage().onload!();

      const result = cache.get('/images/combat/spec.png');
      expect(result).toBeDefined();
      // Should not have created a second image.
      expect(mockImages).toHaveLength(1);
    });
  });
});
