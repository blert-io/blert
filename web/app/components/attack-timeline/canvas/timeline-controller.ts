import { BCFResolver } from '@blert/bcf';

import { TimelineDisplay } from '../display-utils';
import {
  ActionEvaluator,
  CELL_GAP,
  StateProvider,
  TICK_HEIGHT,
} from '../types';

import { hitTest, HitTestResult } from './hit-test';
import { ImageCache } from './image-cache';
import { drawTimeline, TimelineDrawData, TileLayout } from './renderer';
import { TimelineHover, TimelineLayout } from './types';

export type TileInfo = {
  startTick: number;
  tickCount: number;
  logicalWidth: number;
};

export type ControllerData = {
  resolver: BCFResolver;
  display: TimelineDisplay;
  actionEvaluator?: ActionEvaluator;
  stateProvider?: StateProvider;
  letterMode: boolean;
  showInventoryTags: boolean;
  customRowContent: Map<string, Set<number>>;
  onTickSelect?: (tick: number) => void;
  tooltipId: string;
};

export type ControllerLayout = {
  tiles: TileInfo[];
  cellSize: number;
  rowOrder: string[];
};

/**
 * Imperative controller for the canvas timeline.
 *
 * Owns canvas drawing, image loading, DPR tracking, mouse interaction,
 * and rAF scheduling.
 */
export class TimelineController {
  private canvases: HTMLCanvasElement[] = [];
  private data: ControllerData | null = null;
  private layout: ControllerLayout | null = null;

  private imageCache: ImageCache;
  private dpr = 1;
  private dprMql: MediaQueryList | null = null;

  private hover: [TimelineHover, number] | null = null;
  private lastMouseEvent: MouseEvent | null = null;
  private scrollContainer: HTMLElement | null = null;
  private tooltipAnchors: [HTMLDivElement, HTMLDivElement] | null = null;
  private activeAnchorIndex = 0;

  private dirtyTiles = new Set<number>();
  private tilesWithPendingImages = new Set<number>();
  private rafId = 0;

  constructor() {
    this.imageCache = new ImageCache(() => {
      for (const i of this.tilesWithPendingImages) {
        this.markDirty(i);
      }
    });
  }

  /**
   * Sets the canvas elements managed by this controller.
   * @param canvases List of canvas tiles.
   */
  setCanvases(canvases: HTMLCanvasElement[]): void {
    for (const canvas of this.canvases) {
      canvas.removeEventListener('mousemove', this.onMouseMove);
      canvas.removeEventListener('mouseleave', this.onMouseLeave);
      canvas.removeEventListener('click', this.onClick);
    }

    this.canvases = canvases;

    for (const canvas of this.canvases) {
      canvas.addEventListener('mousemove', this.onMouseMove);
      canvas.addEventListener('mouseleave', this.onMouseLeave);
      canvas.addEventListener('click', this.onClick);
    }

    this.syncDpr();
    this.resizeCanvases();
    this.drawAllSync();
  }

  /**
   * Sets the scrollable timeline container to listen for scroll events.
   * @param container Scroll container.
   */
  setScrollContainer(container: HTMLElement | null): void {
    if (this.scrollContainer !== null) {
      this.scrollContainer.removeEventListener('scroll', this.onScroll);
    }
    this.scrollContainer = container;
    if (this.scrollContainer !== null) {
      this.scrollContainer.addEventListener('scroll', this.onScroll);
    }
  }

  /**
   * Redraws the timeline with new data and layout.
   * @param data Timeline data.
   * @param layout Timeline layout.
   */
  update(data: ControllerData, layout: ControllerLayout): void {
    const resolverChanged = this.data?.resolver !== data.resolver;
    this.data = data;
    this.layout = layout;

    if (resolverChanged) {
      this.imageCache.preloadForTimeline(data.resolver);
    }

    this.resizeCanvases();
    this.drawAllSync();
  }

  /** Cleans up event listeners and cancels pending work. */
  destroy(): void {
    for (const canvas of this.canvases) {
      canvas.removeEventListener('mousemove', this.onMouseMove);
      canvas.removeEventListener('mouseleave', this.onMouseLeave);
      canvas.removeEventListener('click', this.onClick);
    }
    this.canvases = [];
    this.setScrollContainer(null);
    if (this.tooltipAnchors !== null) {
      for (const anchor of this.tooltipAnchors) {
        anchor.remove();
      }
      this.tooltipAnchors = null;
    }

    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    if (this.dprMql !== null) {
      this.dprMql.removeEventListener('change', this.onDprChange);
      this.dprMql = null;
    }

    this.lastMouseEvent = null;
  }

  private syncDpr(): void {
    const newDpr = window.devicePixelRatio;
    if (newDpr !== this.dpr) {
      this.dpr = newDpr;
      this.resizeCanvases();
    }
    this.listenForDprChange();
  }

  private listenForDprChange(): void {
    if (this.dprMql !== null) {
      this.dprMql.removeEventListener('change', this.onDprChange);
    }
    this.dprMql = window.matchMedia(`(resolution: ${this.dpr}dppx)`);
    this.dprMql.addEventListener('change', this.onDprChange);
  }

  private onDprChange = (): void => {
    this.dpr = window.devicePixelRatio;
    this.resizeCanvases();
    this.listenForDprChange();
    this.drawAllSync();
  };

  private resizeCanvases(): void {
    if (this.layout === null) {
      return;
    }

    const { tiles, cellSize, rowOrder } = this.layout;
    const canvasHeight =
      TICK_HEIGHT + rowOrder.length * (cellSize + CELL_GAP) + 10;

    for (let i = 0; i < tiles.length; i++) {
      const canvas = this.canvases[i];
      if (canvas === undefined) {
        continue;
      }

      const tile = tiles[i];
      const physicalWidth = Math.round(tile.logicalWidth * this.dpr);
      const physicalHeight = Math.round(canvasHeight * this.dpr);

      if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
        canvas.width = physicalWidth;
        canvas.height = physicalHeight;
        canvas.style.width = `${tile.logicalWidth}px`;
        canvas.style.height = `${canvasHeight}px`;
      }
    }
  }

  private drawAllSync(): void {
    if (this.layout === null) {
      return;
    }
    for (let i = 0; i < this.layout.tiles.length; i++) {
      this.drawTile(i);
    }
  }

  private drawTile(tileIndex: number): void {
    const canvas = this.canvases[tileIndex];
    if (canvas === undefined || this.data === null || this.layout === null) {
      return;
    }

    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      return;
    }

    const tile = this.layout.tiles[tileIndex];
    if (tile === undefined) {
      return;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const drawData: TimelineDrawData = {
      resolver: this.data.resolver,
      display: this.data.display,
      actionEvaluator: this.data.actionEvaluator,
      stateProvider: this.data.stateProvider,
      imageCache: this.imageCache,
      letterMode: this.data.letterMode,
      showInventoryTags: this.data.showInventoryTags,
      customRowContent: this.data.customRowContent,
      hover:
        this.hover !== null && this.hover[1] === tileIndex
          ? this.hover[0]
          : null,
    };

    const tileLayout: TileLayout = {
      cellSize: this.layout.cellSize,
      startTick: tile.startTick,
      tickCount: tile.tickCount,
      rowOrder: this.layout.rowOrder,
    };

    const drawn = drawTimeline(ctx, drawData, tileLayout);
    if (drawn) {
      this.tilesWithPendingImages.delete(tileIndex);
    } else {
      this.tilesWithPendingImages.add(tileIndex);
    }
  }

  /** Marks a tile as needing a redraw. */
  private markDirty(tileIndex: number): void {
    this.dirtyTiles.add(tileIndex);
    if (this.rafId === 0) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0;
        const toRedraw = new Set(this.dirtyTiles);
        this.dirtyTiles.clear();
        for (const i of toRedraw) {
          this.drawTile(i);
        }
      });
    }
  }

  private createAnchorElement(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.position = 'absolute';
    el.style.pointerEvents = 'none';
    el.style.left = '-9999px';
    el.style.top = '-9999px';
    return el;
  }

  private ensureAnchors(row: HTMLElement): void {
    if (this.tooltipAnchors === null) {
      this.tooltipAnchors = [
        this.createAnchorElement(),
        this.createAnchorElement(),
      ];
      row.appendChild(this.tooltipAnchors[0]);
      row.appendChild(this.tooltipAnchors[1]);
    } else {
      // Re-parent if the row changed.
      for (const anchor of this.tooltipAnchors) {
        if (anchor.parentElement !== row) {
          row.appendChild(anchor);
        }
      }
    }
  }

  private showTooltipAnchor(
    tileIndex: number,
    cellX: number,
    cellY: number,
    tick: number,
    rowId: string,
    tooltipType: string,
  ): void {
    if (this.data === null) {
      return;
    }

    const canvas = this.canvases[tileIndex];
    const row = canvas?.parentElement;
    if (canvas === undefined || row === null) {
      return;
    }

    this.ensureAnchors(row);
    const anchors = this.tooltipAnchors!;

    const cellSize = this.layout?.cellSize ?? 0;

    // Hack: react-tooltip won't re-read data attributes from the same anchor
    // element, so alternate between two anchor divs.
    const prevAnchor = anchors[this.activeAnchorIndex];
    prevAnchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    prevAnchor.style.left = '-9999px';
    prevAnchor.style.top = '-9999px';

    this.activeAnchorIndex = this.activeAnchorIndex === 0 ? 1 : 0;
    const anchor = anchors[this.activeAnchorIndex];

    anchor.style.left = `${canvas.offsetLeft + cellX}px`;
    anchor.style.top = `${canvas.offsetTop + cellY}px`;
    anchor.style.width = `${cellSize}px`;
    anchor.style.height = `${cellSize}px`;
    anchor.dataset.tooltipId = this.data.tooltipId;
    anchor.dataset.tooltipType = tooltipType;
    anchor.dataset.tooltipTick = String(tick);

    if (tooltipType === 'actor') {
      anchor.dataset.tooltipActorId = rowId;
      delete anchor.dataset.tooltipRowId;
    } else {
      anchor.dataset.tooltipRowId = rowId;
      delete anchor.dataset.tooltipActorId;
    }

    anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }

  private hideTooltipAnchor(): void {
    if (this.tooltipAnchors === null) {
      return;
    }
    for (const anchor of this.tooltipAnchors) {
      anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      anchor.style.left = '-9999px';
      anchor.style.top = '-9999px';
    }
  }

  private tileIndexForCanvas(canvas: EventTarget): number {
    return this.canvases.indexOf(canvas as HTMLCanvasElement);
  }

  private tileLayout(tileIndex: number): TimelineLayout | null {
    if (this.layout === null) {
      return null;
    }
    const tile = this.layout.tiles[tileIndex];
    if (tile === undefined) {
      return null;
    }
    return {
      cellSize: this.layout.cellSize,
      cellGap: CELL_GAP,
      tickHeight: TICK_HEIGHT,
      startTick: tile.startTick,
      tickCount: tile.tickCount,
      rowOrder: this.layout.rowOrder,
    };
  }

  private onMouseMove = (e: MouseEvent): void => {
    this.lastMouseEvent = e;
    const tileIndex = this.tileIndexForCanvas(e.currentTarget!);
    if (tileIndex === -1) {
      return;
    }

    const layout = this.tileLayout(tileIndex);
    if (layout === null) {
      return;
    }

    const canvas = e.currentTarget as HTMLCanvasElement;
    this.handleHitTest(
      hitTest(e.offsetX, e.offsetY, layout),
      tileIndex,
      canvas,
    );
  };

  private handleHitTest(
    result: HitTestResult | null,
    tileIndex: number,
    canvas: HTMLCanvasElement,
  ): void {
    const prev = this.hover;

    if (result === null) {
      if (prev !== null) {
        this.hover = null;
        this.markDirty(prev[1]);
        this.hideTooltipAnchor();
      }
      canvas.style.cursor = 'default';
      return;
    }

    // Check if hover is unchanged.
    if (prev !== null) {
      const [prevHover, prevTile] = prev;
      if (prevHover.type === result.type && prevHover.tick === result.tick) {
        if (result.type === 'tick-header') {
          return;
        }
        if (prevHover.type === 'cell' && prevHover.rowId === result.rowId) {
          return;
        }
      }
      if (prevTile !== tileIndex) {
        this.markDirty(prevTile);
      }
    }

    this.hover = [result, tileIndex];
    this.markDirty(tileIndex);

    if (result.type === 'cell') {
      const actor = this.data?.resolver.getActor(result.rowId);
      const tooltipType = actor !== undefined ? 'actor' : 'custom';
      this.showTooltipAnchor(
        tileIndex,
        result.cellX,
        result.cellY,
        result.tick,
        result.rowId,
        tooltipType,
      );
      canvas.style.cursor = 'default';
    } else {
      this.hideTooltipAnchor();
      canvas.style.cursor =
        this.data?.onTickSelect !== undefined ? 'pointer' : 'default';
    }
  }

  private onMouseLeave = (): void => {
    this.lastMouseEvent = null;
    const prev = this.hover;
    if (prev !== null) {
      this.hover = null;
      this.markDirty(prev[1]);
    }
    this.hideTooltipAnchor();
  };

  private onScroll = (): void => {
    if (this.lastMouseEvent === null) {
      return;
    }

    const { clientX, clientY } = this.lastMouseEvent;
    const el = document.elementFromPoint(clientX, clientY);
    const tileIndex =
      el instanceof HTMLCanvasElement ? this.tileIndexForCanvas(el) : -1;

    if (tileIndex === -1) {
      // Cursor is no longer over a canvas tile.
      const prev = this.hover;
      if (prev !== null) {
        this.hover = null;
        this.markDirty(prev[1]);
      }
      this.hideTooltipAnchor();
      return;
    }

    const canvas = this.canvases[tileIndex];
    const rect = canvas.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;

    const layout = this.tileLayout(tileIndex);
    if (layout === null) {
      return;
    }

    this.handleHitTest(hitTest(offsetX, offsetY, layout), tileIndex, canvas);
  };

  private onClick = (e: MouseEvent): void => {
    if (this.data?.onTickSelect === undefined) {
      return;
    }

    const tileIndex = this.tileIndexForCanvas(e.currentTarget!);
    if (tileIndex === -1) {
      return;
    }

    const layout = this.tileLayout(tileIndex);
    if (layout === null) {
      return;
    }

    const result = hitTest(e.offsetX, e.offsetY, layout);
    if (result !== null && result.type === 'tick-header') {
      this.data.onTickSelect(result.tick);
    }
  };
}
