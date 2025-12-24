import { useMemo } from 'react';

import { BloatHandsResponse } from '@/actions/challenge';
import Tooltip from '@/components/tooltip';

import { DisplayMode } from './controls';

import styles from './visualizer.module.scss';

const BLOAT_ROOM_SIZE = 16;
const BLOAT_TANK_SIZE = 6;
const BLOAT_TILE_COUNT = BLOAT_ROOM_SIZE * BLOAT_ROOM_SIZE;
const BLOAT_PASSABLE_TILE_COUNT =
  BLOAT_TILE_COUNT - BLOAT_TANK_SIZE * BLOAT_TANK_SIZE;

const RELATIVE_LABEL_THRESHOLD = 4;

type BloatHandsVisualizerProps = {
  data: BloatHandsResponse;
  displayMode: DisplayMode;
  hoveredTile: number | null;
  selectedTile: number | null;
  onTileHover: (tileId: number | null) => void;
  onTileClick: (tileId: number | null) => void;
};

function tileIdToCoords(tileId: number): { x: number; y: number } {
  return {
    x: tileId % BLOAT_ROOM_SIZE,
    y: Math.floor(tileId / BLOAT_ROOM_SIZE),
  };
}

function coordsToTileId(x: number, y: number): number {
  return y * BLOAT_ROOM_SIZE + x;
}

function coordsToChunk(x: number, y: number): number {
  return Math.floor(y / 8) * 2 + Math.floor(x / 8);
}

function isImpassable(x: number, y: number): boolean {
  return x >= 5 && x <= 10 && y >= 5 && y <= 10;
}

function getChunkName(chunk: number): string {
  const names = ['Southwest', 'Southeast', 'Northwest', 'Northeast'];
  return names[chunk] || 'Unknown';
}

const TOOLTIP_ID = 'bloat-tile-tooltip';

function TileTooltipRenderer({
  activeAnchor,
}: {
  activeAnchor: HTMLElement | null;
}) {
  if (!activeAnchor) {
    return null;
  }

  const rank = activeAnchor.dataset.rank ?? 'N/A';
  const tileId = parseInt(activeAnchor.dataset.tileId ?? '0');
  const handCount = parseInt(activeAnchor.dataset.handCount ?? '0');
  const displayValue = activeAnchor.dataset.displayValue ?? '0%';
  const displayMode = activeAnchor.dataset.displayMode ?? 'percentage';
  const coords = tileIdToCoords(tileId);
  const chunk = coordsToChunk(coords.x, coords.y);

  const value = parseFloat(displayValue.substring(0, displayValue.length - 1));

  return (
    <div className={styles.tileTooltip}>
      <div className={styles.tileHeader}>
        <div className={styles.tileId}>Tile {tileId}</div>
        <div className={styles.tileCoords}>
          ({coords.x}, {coords.y})
        </div>
      </div>
      <div className={styles.tileStats}>
        <div className={styles.tileStat}>
          <span>Hands:</span>
          <span>{handCount}</span>
        </div>
        <div className={styles.tileStat}>
          {displayMode === 'percentage' ? (
            <>
              <span>Percentage:</span>
              <span>{displayValue}</span>
            </>
          ) : (
            <>
              <span>Relative:</span>
              <span
                style={{
                  color:
                    Math.abs(value) < RELATIVE_LABEL_THRESHOLD
                      ? 'var(--blert-font-color-primary)'
                      : value > 0
                        ? 'var(--blert-green)'
                        : 'var(--blert-red)',
                }}
              >
                {displayValue}
              </span>
            </>
          )}
        </div>
        <div className={styles.tileStat}>
          <span>Rank:</span>
          <span>{rank}</span>
        </div>
        <div className={styles.tileStat}>
          <span>Chunk:</span>
          <span>
            {chunk} ({getChunkName(chunk)})
          </span>
        </div>
      </div>
    </div>
  );
}

type TileData = {
  tileId: number;
  x: number;
  y: number;
  handCount: number;
  rank: string | null;
  displayValue: number;
  displayText: string;
  chunk: number;
  isImpassable: boolean;
};

export default function BloatHandsVisualizer({
  data,
  displayMode,
  hoveredTile,
  selectedTile,
  onTileHover,
  onTileClick,
}: BloatHandsVisualizerProps) {
  const { tileData, colorScale, legendLabels } = useMemo(() => {
    const tiles: (TileData | null)[] = new Array<TileData | null>(
      BLOAT_TILE_COUNT,
    ).fill(null);

    const handCounts: Record<string, number> = {};
    let maxCount = 0;

    if (data.data.view === 'total') {
      Object.entries(data.data.byTile).forEach(([tileId, count]) => {
        handCounts[tileId] = count;
        maxCount = Math.max(maxCount, count);
      });
    } else if (data.data.view === 'chunk') {
      Object.entries(data.data.byChunk).forEach(([chunk, count]) => {
        const chunkNum = parseInt(chunk);
        for (let y = 0; y < BLOAT_ROOM_SIZE; y++) {
          for (let x = 0; x < BLOAT_ROOM_SIZE; x++) {
            if (coordsToChunk(x, y) === chunkNum) {
              const tileId = coordsToTileId(x, y);
              handCounts[tileId] = Math.floor(count / 64);
              maxCount = Math.max(maxCount, handCounts[tileId]);
            }
          }
        }
      });
    }

    const displayValues: Record<string, { value: number; text: string }> = {};
    let minDisplayValue = 0;
    let maxDisplayValue = 0;

    if (displayMode === 'percentage') {
      Object.entries(handCounts).forEach(([tileId, count]) => {
        const percentage =
          data.totalHands > 0 ? (count / data.totalHands) * 100 : 0;
        displayValues[tileId] = {
          value: percentage,
          text: `${percentage.toFixed(1)}%`,
        };
        maxDisplayValue = Math.max(maxDisplayValue, percentage);
      });
    } else {
      const averageHandsPerTile = data.totalHands / BLOAT_PASSABLE_TILE_COUNT;

      Object.entries(handCounts).forEach(([tileId, count]) => {
        const relativePercentage =
          averageHandsPerTile > 0
            ? ((count - averageHandsPerTile) / averageHandsPerTile) * 100
            : 0;
        const sign = relativePercentage > 0 ? '+' : '';
        displayValues[parseInt(tileId)] = {
          value: relativePercentage,
          text: `${sign}${relativePercentage.toFixed(1)}%`,
        };
        minDisplayValue = Math.min(minDisplayValue, relativePercentage);
        maxDisplayValue = Math.max(maxDisplayValue, relativePercentage);
      });
    }

    let tilesWithHands = 0;

    for (let y = 0; y < BLOAT_ROOM_SIZE; y++) {
      for (let x = 0; x < BLOAT_ROOM_SIZE; x++) {
        const tileId = coordsToTileId(x, y);
        const handCount = handCounts[tileId] || 0;
        const display = displayValues[tileId] || { value: 0, text: '0%' };

        if (handCount > 0) {
          tilesWithHands++;
        }

        tiles[tileId] = {
          tileId,
          x,
          y,
          handCount,
          rank: null,
          displayValue: display.value,
          displayText: display.text,
          chunk: coordsToChunk(x, y),
          isImpassable: isImpassable(x, y),
        };
      }
    }

    Object.entries(handCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([tileId, _], index) => {
        const tile = tiles[parseInt(tileId)];
        if (tile && tile.handCount > 0) {
          tile.rank = `${index + 1} / ${tilesWithHands}`;
        }
      });

    const getColorIntensity = (value: number): number => {
      if (displayMode === 'percentage') {
        return maxDisplayValue === 0 ? 0 : value / maxDisplayValue;
      }

      // For relative mode, treat negative and positive gradients as
      // separate scales.
      if (value < 0) {
        return 1 - value / minDisplayValue;
      }

      return value / maxDisplayValue;
    };

    const labels =
      displayMode === 'percentage'
        ? ['0%', `${maxDisplayValue.toFixed(1)}%`]
        : [
            `${minDisplayValue.toFixed(0)}%`,
            '0%',
            `+${maxDisplayValue.toFixed(0)}%`,
          ];

    return {
      tileData: tiles,
      colorScale: getColorIntensity,
      legendLabels: labels,
    };
  }, [data, displayMode]);

  const handleTileMouseEnter = (tileId: number) => {
    onTileHover(tileId);
  };

  const handleTileMouseLeave = () => {
    onTileHover(null);
  };

  const handleTileClick = (tileId: number) => {
    onTileClick(selectedTile === tileId ? null : tileId);
  };

  let topTiles: {
    tileId: number;
    count: number;
    percentage: number;
  }[] = [];
  if (data.data.view === 'total') {
    topTiles = Object.entries(data.data.byTile)
      .map(([tileId, count]) => ({
        tileId: parseInt(tileId),
        count,
        percentage: (count / data.totalHands) * 100,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }

  return (
    <div className={styles.visualizer}>
      <div className={styles.gridContainer}>
        <div className={styles.coordinateLabels}>
          <div className={styles.mainGrid}>
            {Array.from({ length: BLOAT_ROOM_SIZE }, (_, renderY) => {
              // Flip the display order so y=0 appears at bottom
              const displayY = 15 - renderY;
              return (
                <div key={displayY} className={styles.gridRow}>
                  <div className={styles.leftLabel}>{displayY}</div>
                  <div className={styles.tilesRow}>
                    {Array.from({ length: BLOAT_ROOM_SIZE }, (_, x) => {
                      const tile = tileData[coordsToTileId(x, displayY)];
                      if (!tile) {
                        return null;
                      }

                      const intensity = colorScale(tile.displayValue);
                      const isHovered = hoveredTile === tile.tileId;
                      const isSelected = selectedTile === tile.tileId;

                      const shouldShowDisplayValue =
                        !tile.isImpassable &&
                        ((displayMode === 'percentage' &&
                          tile.displayValue > 0.02) ||
                          (displayMode === 'relative' &&
                            Math.abs(tile.displayValue) >=
                              RELATIVE_LABEL_THRESHOLD));

                      const classNames = [styles.tile];
                      if (tile.isImpassable) {
                        classNames.push(styles.impassable);
                      } else {
                        if (isHovered) {
                          classNames.push(styles.hovered);
                        }
                        if (isSelected) {
                          classNames.push(styles.selected);
                        }
                        if (displayMode === 'relative') {
                          classNames.push(styles.relativeTile);
                          classNames.push(
                            tile.displayValue >= 0
                              ? styles.positive
                              : styles.negative,
                          );
                        }
                      }

                      return (
                        <div
                          key={tile.tileId}
                          className={classNames.join(' ')}
                          style={
                            {
                              '--intensity': intensity,
                            } as React.CSSProperties
                          }
                          data-tooltip-id={
                            tile.isImpassable ? undefined : TOOLTIP_ID
                          }
                          data-tile-id={tile.tileId}
                          data-rank={tile.rank}
                          data-hand-count={tile.handCount}
                          data-display-value={tile.displayText}
                          data-display-mode={displayMode}
                          onMouseEnter={() => handleTileMouseEnter(tile.tileId)}
                          onMouseLeave={handleTileMouseLeave}
                          onClick={() =>
                            !tile.isImpassable && handleTileClick(tile.tileId)
                          }
                          title={
                            tile.isImpassable ? 'Impassable area' : undefined
                          }
                        >
                          {shouldShowDisplayValue && (
                            <div className={styles.displayValue}>
                              {displayMode === 'percentage'
                                ? `${tile.displayValue.toFixed(1)}`
                                : `${tile.displayValue > 0 ? '+' : ''}${tile.displayValue.toFixed(0)}%`}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className={styles.bottomLabels}>
            <div className={styles.corner}></div>
            {Array.from({ length: BLOAT_ROOM_SIZE }, (_, i) => (
              <div key={i} className={styles.coordLabel}>
                {i}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.chunkOverlay}>
          <div
            className={styles.chunkBoundary}
            style={{ left: '50%', top: 0, bottom: 0 }}
          />
          <div
            className={styles.chunkBoundary}
            style={{ top: '50%', left: 0, right: 0 }}
          />
        </div>
      </div>

      <div className={styles.bottomSection}>
        <div className={styles.legend}>
          <div className={styles.legendTitle}>
            {displayMode === 'percentage'
              ? 'Hand Spawn Percentage'
              : 'Relative to Average'}
          </div>
          <div className={styles.colorBar}>
            <div
              className={`${styles.colorGradient} ${
                displayMode === 'relative' ? styles.relativeGradient : ''
              }`}
            />
            <div
              className={`${styles.legendLabels} ${
                displayMode === 'relative' ? styles.threeLabelLayout : ''
              }`}
            >
              {displayMode === 'relative' ? (
                <>
                  <span>{legendLabels[0]}</span>
                  <span>{legendLabels[1]}</span>
                  <span>{legendLabels[2]}</span>
                </>
              ) : (
                <>
                  <span>{legendLabels[0]}</span>
                  <span>{legendLabels[1]}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {topTiles.length > 0 && (
          <div className={styles.topSpawnLocations}>
            <h3 className={styles.topSpawnTitle}>Top Spawn Locations</h3>
            <div className={styles.topTiles}>
              {topTiles.map((tile, index) => (
                <div key={tile.tileId} className={styles.topTile}>
                  <div className={styles.rank}>#{index + 1}</div>
                  <div className={styles.tileDetails}>
                    <div className={styles.tileTitle}>
                      Tile {tile.tileId}{' '}
                      <span className={styles.tileCoords}>
                        ({tileIdToCoords(tile.tileId).x},{' '}
                        {tileIdToCoords(tile.tileId).y})
                      </span>
                    </div>
                    <div className={styles.tileCount}>
                      {tile.count} hands ({tile.percentage.toFixed(1)}%)
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Tooltip
        tooltipId={TOOLTIP_ID}
        render={TileTooltipRenderer}
        clickable={false}
      />
    </div>
  );
}
