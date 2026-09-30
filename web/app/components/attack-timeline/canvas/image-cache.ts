import { BCFResolver } from '@blert/bcf';

import { getActionMetadata } from '../attack-metadata';

const MAX_RETRIES = 2;

type ImageEntry =
  | { status: 'loading'; image: HTMLImageElement; retries: number }
  | { status: 'loaded'; image: HTMLImageElement }
  | { status: 'error' };

/**
 * Image loader and cache.
 *
 * Manages HTMLImageElement instances keyed by URL. Images are loaded lazily
 * on first access via `get()`. When an image finishes loading, the `onLoad`
 * callback fires.
 */
export class ImageCache {
  private cache = new Map<string, ImageEntry>();
  private onLoad: (url: string) => void;

  constructor(onLoad: (url: string) => void) {
    this.onLoad = onLoad;
  }

  /**
   * Returns the loaded HTMLImageElement for the given URL, or undefined if
   * the image is still loading or failed to load. Starts loading on first
   * access.
   */
  get(url: string): HTMLImageElement | undefined {
    const entry = this.cache.get(url);

    if (entry === undefined) {
      this.startLoad(url);
      return undefined;
    }

    if (entry.status === 'loaded') {
      return entry.image;
    }

    return undefined;
  }

  /** Starts loading an image. */
  preload(url: string): void {
    if (!this.cache.has(url)) {
      this.startLoad(url);
    }
  }

  /**
   * Preloads all images needed for a BCF timeline's actions.
   * @param resolver Resolved BCF document.
   */
  preloadForTimeline(resolver: BCFResolver): void {
    const urls = new Set<string>();

    for (const tick of resolver.ticks()) {
      for (const cell of tick.cells) {
        if (cell.actions === undefined) {
          continue;
        }

        for (const action of cell.actions) {
          const { imageUrl } = getActionMetadata(action);
          if (imageUrl !== undefined) {
            urls.add(imageUrl);
          }
        }
      }
    }

    // Static overlay icons.
    urls.add('/images/combat/barrage.png');
    urls.add('/images/combat/spec.png');
    urls.add('/images/combat/dark-demonbane.webp');
    urls.add('/images/combat/ice-rush.png');
    urls.add('/images/combat/skull.webp');
    urls.add('/images/combat/punch.webp');
    urls.add('/images/combat/kick.webp');
    urls.add('/images/huh.png');

    for (const url of urls) {
      this.preload(url);
    }
  }

  private startLoad(url: string, retriesLeft = MAX_RETRIES): void {
    if (typeof Image === 'undefined') {
      return;
    }

    const img = new Image();

    if (url.startsWith('http')) {
      img.crossOrigin = 'anonymous';
    }

    this.cache.set(url, {
      status: 'loading',
      image: img,
      retries: retriesLeft,
    });

    img.onload = () => {
      this.cache.set(url, { status: 'loaded', image: img });
      this.onLoad(url);
    };

    img.onerror = () => {
      if (retriesLeft > 0) {
        this.cache.delete(url);
        setTimeout(() => this.startLoad(url, retriesLeft - 1), 1000);
      } else {
        this.cache.set(url, { status: 'error' });
      }
    };

    img.src = url;
  }
}
