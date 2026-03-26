import { BCFPlayerAction, BCFResolver } from '@blert/bcf';

import { TimelineDisplay } from '../display-utils';
import {
  ActionEvaluation,
  ActionEvaluator,
  CELL_GAP,
  mergeEvaluations,
  StateProvider,
  TICK_HEIGHT,
} from '../types';

import { drawPlayerCell, drawNpcCell } from './cell-content';
import { CellCategory, drawCell, resolveCellStyle } from './cell';
import { getChartColor, TEXT_PRIMARY, TEXT_TICK_HEADER } from './colors';
import { ImageCache } from './image-cache';
import { Point, TimelineHover } from './types';

export type TimelineDrawData = {
  resolver: BCFResolver;
  display: TimelineDisplay;
  actionEvaluator?: ActionEvaluator;
  stateProvider?: StateProvider;
  imageCache: ImageCache;
  hover: TimelineHover | null;
  letterMode: boolean;
  showInventoryTags: boolean;
  /** Set of ticks with non-null content for each custom row ID. */
  customRowContent: Map<string, Set<number>>;
};

export type TileLayout = {
  cellSize: number;
  startTick: number;
  tickCount: number;
  rowOrder: string[];
};

/**
 * Draws a single tile of the timeline.
 *
 * @param ctx Canvas context.
 * @param data The data to draw.
 * @param layout The layout of the tile.
 * @returns `true` if the timeline was fully drawn. If `false`, the tile should
 *   be redrawn when images are loaded.
 */
export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  data: TimelineDrawData,
  layout: TileLayout,
): boolean {
  const { resolver, display, imageCache, hover } = data;
  const { cellSize, startTick, tickCount, rowOrder } = layout;

  const columnWidth = cellSize + CELL_GAP;
  const gridTop = TICK_HEIGHT;

  // Clear the entire canvas. Reset transform first to clear all physical pixels
  // regardless of DPR scaling, then re-apply the transform.
  const savedTransform = ctx.getTransform();
  ctx.resetTransform();
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(savedTransform);

  let pending = false;

  for (let col = 0; col < tickCount; col++) {
    const tick = startTick + col;
    const colX = col * columnWidth;

    const bgColor = display.getBackgroundColorAt(tick);

    for (let row = 0; row < rowOrder.length; row++) {
      const rowId = rowOrder[row];
      const cellPos: Point = {
        x: colX,
        y: gridTop + row * columnWidth,
      };
      const isHovered =
        hover !== null &&
        hover.type === 'cell' &&
        hover.tick === tick &&
        hover.rowId === rowId;

      const actor = resolver.getActor(rowId);

      if (actor !== undefined) {
        const cell = resolver.getCell(rowId, tick);

        if (actor.type === 'npc') {
          const hasAttack =
            cell?.actions?.some((a) => a.type === 'npcAttack') ?? false;
          const category: CellCategory = hasAttack ? 'npcAttack' : 'default';
          const chartBg =
            bgColor !== undefined
              ? getChartColor(bgColor.color, bgColor.intensity)
              : undefined;

          const style = resolveCellStyle(
            category,
            undefined,
            isHovered,
            chartBg,
          );
          drawCell(ctx, cellPos, cellSize, style);

          const npcLabel = display.getNpcLabel(rowId, tick);
          const externalStates = data.stateProvider?.(tick, rowId) ?? [];

          pending ||= drawNpcCell(ctx, cellPos, cellSize, imageCache, {
            cell,
            npcLabel,
            externalStates,
          });
        } else {
          // Player cell.
          const state = resolver.getPlayerState(rowId, tick);
          const diedThisTick =
            cell?.actions?.some((a) => a.type === 'death') ?? false;
          const offCooldown = state?.offCooldown ?? false;
          const hasActions = (cell?.actions?.length ?? 0) > 0;

          let category: CellCategory;
          if (state?.isDead && !diedThisTick) {
            category = 'dead';
          } else if (offCooldown || hasActions) {
            category = 'highlighted';
          } else {
            category = 'default';
          }

          let evaluation: ActionEvaluation = {};
          for (const action of cell?.actions ?? []) {
            if (data.actionEvaluator !== undefined) {
              const ev = data.actionEvaluator(
                tick,
                rowId,
                action as BCFPlayerAction,
              );
              if (ev !== null) {
                evaluation = mergeEvaluations(evaluation, ev);
              }
            }
          }

          const chartBg =
            category !== 'dead' && bgColor !== undefined
              ? getChartColor(bgColor.color, bgColor.intensity)
              : undefined;

          const style = resolveCellStyle(
            category,
            evaluation.outline,
            isHovered,
            chartBg,
          );
          drawCell(ctx, cellPos, cellSize, style);

          const externalStates = data.stateProvider?.(tick, rowId) ?? [];

          pending ||= drawPlayerCell(ctx, cellPos, cellSize, imageCache, {
            actions: cell?.actions ?? [],
            diedThisTick,
            blunder: evaluation.blunder ?? false,
            externalStates,
            letterMode: data.letterMode,
            showInventoryTags: data.showInventoryTags,
          });
        }
      } else {
        // For custom rows, only draw the background, highlighting cells if they
        // have custom content. The content is drawn using a DOM overlay.
        const hasContent = data.customRowContent.get(rowId)?.has(tick) ?? false;
        const category: CellCategory = hasContent ? 'highlighted' : 'default';
        const chartBg =
          bgColor !== undefined
            ? getChartColor(bgColor.color, bgColor.intensity)
            : undefined;

        const style = resolveCellStyle(category, undefined, isHovered, chartBg);
        drawCell(ctx, cellPos, cellSize, style);
      }
    }

    // Tick header.
    const isTickHovered =
      hover !== null && hover.type === 'tick-header' && hover.tick === tick;
    ctx.font = `${Math.floor(cellSize / 2) - 1}px 'Plus Jakarta Sans', sans-serif`;
    ctx.fillStyle = isTickHovered ? TEXT_PRIMARY : TEXT_TICK_HEADER;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(tick), colX + cellSize / 2, TICK_HEIGHT / 2);
  }

  return !pending;
}
