import { BCFResolver } from '@blert/bcf';

import { clamp } from '@/utils/math';

import { TimelineDisplay } from '../display-utils';
import {
  ActionEvaluator,
  CELL_GAP,
  StateProvider,
  TICK_HEIGHT,
} from '../types';

import {
  hitTest,
  HitTestResult,
  nearestCell,
  NearestCellHit,
} from './hit-test';
import { ImageCache } from './image-cache';
import { buildTimelinePalette, TimelinePalette } from './palette';
import { drawTimeline, TimelineDrawData, TileLayout } from './renderer';
import { TimelineHover, TimelineLayout } from './types';

export type TileInfo = {
  startTick: number;
  tickCount: number;
  logicalWidth: number;
};

export type PointerHit = HitTestResult | NearestCellHit;

/**
 * Receives pointer events over the timeline, pairing each with the cell or tick
 * header under the pointer.
 *
 * From a press until its release, move events and the release event are
 * delivered even when the pointer leaves the canvas. While the pointer is not
 * over a cell or tick header in that time, they are invoked with the nearest
 * cell instead. If the timeline scrolls under the pointer in that time, the
 * last move event is delivered again.
 */
export type InteractionHandler = {
  onPointerDown?: (hit: PointerHit | null, event: PointerEvent) => void;
  onPointerMove?: (hit: PointerHit | null, event: PointerEvent) => void;
  onPointerUp?: (hit: PointerHit | null, event: PointerEvent) => void;
  /**
   * Callback invoked on each `hit` target change returning the CSS cursor value
   * to display over it. `undefined` uses the default cursor.
   */
  cursor?: (hit: HitTestResult | null) => string | undefined;
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
  interactionHandler?: InteractionHandler;
  tooltipId: string;
};

export type ControllerLayout = {
  tiles: TileInfo[];
  cellSize: number;
  rowOrder: string[];
};

type ResolvedHit = {
  hit: PointerHit | null;
  tileIndex: number;
  canvas: HTMLCanvasElement;
};

/** Returns the distance from `value` to `[min, max]`, or 0 within it. */
function distanceToRange(value: number, min: number, max: number): number {
  return Math.max(min - value, 0, value - max);
}

/** Returns the part of the viewport that `element` can be seen in. */
function clipAreaOf(element: Element): DOMRect {
  let left = 0;
  let top = 0;
  let right = window.innerWidth;
  let bottom = window.innerHeight;
  for (let el = element.parentElement; el !== null; el = el.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(el);
    if (overflowX === 'visible' && overflowY === 'visible') {
      continue;
    }
    const rect = el.getBoundingClientRect();
    left = Math.max(left, rect.left);
    top = Math.max(top, rect.top);
    right = Math.min(right, rect.right);
    bottom = Math.min(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

function isSameHover(hover: TimelineHover, hit: HitTestResult): boolean {
  if (hover.type !== hit.type || hover.tick !== hit.tick) {
    return false;
  }
  return (
    hover.type !== 'cell' || hit.type !== 'cell' || hover.rowId === hit.rowId
  );
}

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
  private palette: TimelinePalette = buildTimelinePalette();

  private imageCache: ImageCache;
  private dpr = 1;
  private dprMql: MediaQueryList | null = null;
  private themeObserver: MutationObserver | null = null;

  private hover: [HitTestResult, number] | null = null;
  private cursor = 'default';
  private lastPointerEvent: PointerEvent | null = null;
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
      this.removeListeners(canvas);
    }

    this.canvases = canvases;

    for (const canvas of this.canvases) {
      canvas.addEventListener('pointermove', this.onPointerMove);
      canvas.addEventListener('pointerleave', this.onPointerLeave);
      canvas.addEventListener('pointerdown', this.onPointerDown);
      canvas.addEventListener('pointerup', this.onPointerUp);
      canvas.addEventListener('click', this.onClick);
    }
    document.addEventListener('scroll', this.onScroll, true);

    this.observeTheme();
    this.syncDpr();
    this.resizeCanvases();
    this.drawAllSync();
  }

  /**
   * Redraws the timeline with new data and layout.
   * @param data Timeline data.
   * @param layout Timeline layout.
   */
  update(data: ControllerData, layout: ControllerLayout): void {
    const resolverChanged = this.data?.resolver !== data.resolver;
    const handlerChanged =
      this.data?.interactionHandler !== data.interactionHandler;
    this.data = data;
    this.layout = layout;

    if (resolverChanged) {
      this.imageCache.preloadForTimeline(data.resolver);
    }

    if (handlerChanged && this.hover !== null) {
      const [hit, tileIndex] = this.hover;
      this.cursor = this.cursorFor(hit);
      this.canvases[tileIndex].style.cursor = this.cursor;
    }

    this.resizeCanvases();
    this.drawAllSync();
  }

  /** Cleans up event listeners and cancels pending work. */
  destroy(): void {
    for (const canvas of this.canvases) {
      this.removeListeners(canvas);
    }
    this.canvases = [];
    document.removeEventListener('scroll', this.onScroll, true);
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

    if (this.themeObserver !== null) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }

    this.lastPointerEvent = null;
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

  /**
   * Rebuilds the palette and redraws when the document's `data-theme` changes,
   * so the timeline updates immediately on a theme switch.
   */
  private observeTheme(): void {
    if (
      this.themeObserver !== null ||
      typeof MutationObserver === 'undefined'
    ) {
      return;
    }
    this.themeObserver = new MutationObserver(() => {
      this.palette = buildTimelinePalette();
      this.drawAllSync();
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
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
      palette: this.palette,
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

  private removeListeners(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('click', this.onClick);
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

  private resolvePointer(e: PointerEvent): ResolvedHit | null {
    const canvas = e.currentTarget as HTMLCanvasElement;
    if (canvas.hasPointerCapture(e.pointerId)) {
      return this.resolveHeldPointer(e.clientX, e.clientY);
    }
    return this.resolveHit(canvas, e.clientX, e.clientY);
  }

  private resolveHeldPointer(
    clientX: number,
    clientY: number,
  ): ResolvedHit | null {
    const resolved = this.resolveHitAtPoint(clientX, clientY);
    if (resolved !== null && resolved.hit !== null) {
      return resolved;
    }
    return this.resolveNearestCell(clientX, clientY);
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.lastPointerEvent = e;
    const resolved = this.resolvePointer(e);
    if (resolved === null) {
      this.clearHover();
    } else {
      this.handleHitTest(resolved.hit, resolved.tileIndex, resolved.canvas);
    }
    this.data?.interactionHandler?.onPointerMove?.(resolved?.hit ?? null, e);
  };

  private handleHitTest(
    result: PointerHit | null,
    tileIndex: number,
    canvas: HTMLCanvasElement,
  ): void {
    const prev = this.hover;

    if (result === null || result.type === 'nearest-cell') {
      this.clearHover();
      canvas.style.cursor = this.cursor;
      return;
    }

    if (prev !== null) {
      const [prevHover, prevTile] = prev;
      if (isSameHover(prevHover, result)) {
        return;
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
    } else {
      this.hideTooltipAnchor();
    }

    this.cursor = this.cursorFor(result);
    canvas.style.cursor = this.cursor;
  }

  private cursorFor(hit: HitTestResult | null): string {
    const cursor = this.data?.interactionHandler?.cursor?.(hit);
    if (cursor !== undefined) {
      return cursor;
    }
    if (hit?.type === 'tick-header' && this.data?.onTickSelect !== undefined) {
      return 'pointer';
    }
    return 'default';
  }

  private clearHover(): void {
    const prev = this.hover;
    if (prev === null) {
      return;
    }
    this.hover = null;
    this.markDirty(prev[1]);
    this.hideTooltipAnchor();
    this.cursor = this.cursorFor(null);
  }

  private onPointerLeave = (e: PointerEvent): void => {
    this.lastPointerEvent = null;
    this.clearHover();
    this.data?.interactionHandler?.onPointerMove?.(null, e);
  };

  private onPointerDown = (e: PointerEvent): void => {
    const handler = this.data?.interactionHandler;
    if (handler === undefined) {
      return;
    }
    const hit = this.resolvePointer(e)?.hit ?? null;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    handler.onPointerDown?.(hit, e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const handler = this.data?.interactionHandler;
    if (handler === undefined) {
      return;
    }
    handler.onPointerUp?.(this.resolvePointer(e)?.hit ?? null, e);
  };

  private resolveHit(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): ResolvedHit | null {
    const tileIndex = this.tileIndexForCanvas(canvas);
    const layout = this.tileLayout(tileIndex);
    if (layout === null) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(clientX - rect.left, clientY - rect.top, layout);
    return { hit, tileIndex, canvas };
  }

  /** Resolves the hit on whichever tile is under a point, if any. */
  private resolveHitAtPoint(
    clientX: number,
    clientY: number,
  ): ResolvedHit | null {
    const el = document.elementFromPoint(clientX, clientY);
    if (!(el instanceof HTMLCanvasElement) || !this.canvases.includes(el)) {
      return null;
    }
    return this.resolveHit(el, clientX, clientY);
  }

  /**
   * Resolves the visible cell nearest to a point, preferring the wrapped line
   * of tiles level with the point over any line above or below it.
   */
  private resolveNearestCell(
    clientX: number,
    clientY: number,
  ): ResolvedHit | null {
    const first = this.canvases.at(0);
    if (first === undefined) {
      return null;
    }
    const area = clipAreaOf(first);
    const x = clamp(clientX, area.left, area.right - 1);
    const y = clamp(clientY, area.top, area.bottom - 1);

    let nearest: {
      canvas: HTMLCanvasElement;
      rect: DOMRect;
      dx: number;
      dy: number;
    } | null = null;
    for (const canvas of this.canvases) {
      const rect = canvas.getBoundingClientRect();
      if (
        rect.right <= area.left ||
        rect.left >= area.right ||
        rect.bottom <= area.top ||
        rect.top >= area.bottom
      ) {
        continue;
      }
      const dx = distanceToRange(x, rect.left, rect.right);
      const dy = distanceToRange(y, rect.top, rect.bottom);
      if (
        nearest === null ||
        dy < nearest.dy ||
        (dy === nearest.dy && dx < nearest.dx)
      ) {
        nearest = { canvas, rect, dx, dy };
      }
    }
    if (nearest === null) {
      return null;
    }

    const { canvas, rect } = nearest;
    const tileIndex = this.tileIndexForCanvas(canvas);
    const layout = this.tileLayout(tileIndex);
    if (layout === null) {
      return null;
    }
    const hit = nearestCell(x - rect.left, y - rect.top, layout);
    return hit === null ? null : { hit, tileIndex, canvas };
  }

  private onScroll = (): void => {
    const e = this.lastPointerEvent;
    if (e === null) {
      return;
    }

    const { clientX, clientY } = e;
    const held = (e.target as HTMLCanvasElement).hasPointerCapture(e.pointerId);
    const resolved = held
      ? this.resolveHeldPointer(clientX, clientY)
      : this.resolveHitAtPoint(clientX, clientY);
    if (resolved === null) {
      // Cursor is no longer over a canvas tile.
      this.clearHover();
    } else {
      this.handleHitTest(resolved.hit, resolved.tileIndex, resolved.canvas);
    }
    if (held) {
      this.data?.interactionHandler?.onPointerMove?.(resolved?.hit ?? null, e);
    }
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
