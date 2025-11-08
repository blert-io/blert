'use client';

import { useContext } from 'react';

import Item from '@/components/item';
import { extendedItemCache } from '@/utils/item-cache/extended';

import {
  PlacementMode,
  SLOT_SIZE_PX,
  canPlaceRegion,
  getContainerDimensions,
} from './container-grid';
import {
  OperationMode,
  SelectionRegion,
  SetupEditingContext,
} from './editing-context';
import { Container } from './setup';

import styles from './placement-preview.module.scss';

function placementModeIndicator(mode: PlacementMode): [string, string] {
  switch (mode) {
    case PlacementMode.REPLACE:
      return [styles.replace, 'REPLACE'];
    case PlacementMode.MERGE:
      return [styles.merge, 'MERGE'];
    case PlacementMode.SWAP:
      return [styles.swap, 'SWAP'];
  }
}

type PlacementPreviewProps = {
  container: Container;
  playerIndex: number;
};

export function PlacementPreview({
  container,
  playerIndex,
}: PlacementPreviewProps) {
  const context = useContext(SetupEditingContext);
  if (context === null) {
    return null;
  }

  const {
    selection,
    operationMode,
    placementHoverTarget,
    clipboard,
    placementOffset,
  } = context;

  if (placementHoverTarget === null) {
    return null;
  }
  if (
    placementHoverTarget.container !== container ||
    placementHoverTarget.playerIndex !== playerIndex
  ) {
    return null;
  }

  let regionToPreview: SelectionRegion;
  let placementMode: PlacementMode;
  let isMovingItems: boolean;
  const hoverCoords = placementHoverTarget.gridCoords;

  switch (operationMode) {
    case OperationMode.DRAGGING:
      if (selection === null) {
        return null;
      }
      regionToPreview = selection;
      placementMode = PlacementMode.SWAP;
      isMovingItems = true;
      break;
    case OperationMode.CLIPBOARD_CUT:
    case OperationMode.CLIPBOARD_COPY:
      if (clipboard === null) {
        return null;
      }
      regionToPreview = clipboard.region;
      placementMode = clipboard.pasteMode;
      isMovingItems = operationMode === OperationMode.CLIPBOARD_CUT;
      break;
    default:
      return null;
  }

  const { cols, rows } = getContainerDimensions(container);

  const targetPlayer = context.setup.players[placementHoverTarget.playerIndex];
  const sourcePlayer =
    context.setup.players[regionToPreview.bounds.playerIndex];

  const validation = canPlaceRegion(
    regionToPreview,
    placementHoverTarget,
    targetPlayer,
    sourcePlayer,
    placementMode,
    isMovingItems,
    placementOffset,
  );

  // Render preview items at their target positions.
  const previewItems: React.ReactElement[] = [];

  const anchorX =
    hoverCoords[0] -
    (placementOffset?.[0] ?? Math.floor(regionToPreview.bounds.width / 2));
  const anchorY =
    hoverCoords[1] -
    (placementOffset?.[1] ?? Math.floor(regionToPreview.bounds.height / 2));

  for (const [key, slotData] of validation.slotResults) {
    const [targetX, targetY] = slotData.targetCoords;
    if (targetX < 0 || targetX >= cols || targetY < 0 || targetY >= rows) {
      continue;
    }

    let className = styles.previewSlot;
    if (placementMode === PlacementMode.MERGE) {
      className += ` ${slotData.valid ? styles.valid : styles.invalid}`;
    } else {
      className += ` ${validation.canPlace ? styles.valid : styles.invalid}`;
    }

    const item = regionToPreview.slots.get(key)?.slot?.item;

    previewItems.push(
      <div
        key={key}
        className={className}
        style={{
          gridColumn: targetX + 1,
          gridRow: targetY + 1,
          width: `${SLOT_SIZE_PX}px`,
          height: `${SLOT_SIZE_PX}px`,
        }}
      >
        {item && (
          <Item
            className={styles.previewItem}
            id={item.id}
            name={extendedItemCache.getItemName(item.id)}
            quantity={item.quantity}
            size={30}
          />
        )}
      </div>,
    );
  }

  const [modeClassName, modeString] = placementModeIndicator(placementMode);

  const visibleLeft = Math.max(0, anchorX);
  const visibleRight = Math.min(cols, anchorX + regionToPreview.bounds.width);
  const visibleTop = Math.max(0, anchorY);
  const visibleBottom = Math.min(rows, anchorY + regionToPreview.bounds.height);

  const previewCols = visibleRight - visibleLeft;
  const previewRows = visibleBottom - visibleTop;

  return (
    <div
      className={styles.preview}
      style={{
        gridTemplateColumns: `repeat(${previewCols}, 1fr)`,
        gridTemplateRows: `repeat(${previewRows}, 1fr)`,
        width: `${previewCols * SLOT_SIZE_PX}px`,
        height: `${previewRows * SLOT_SIZE_PX}px`,
        top: `${Math.max(0, anchorY) * SLOT_SIZE_PX}px`,
        left: `${Math.max(0, anchorX) * SLOT_SIZE_PX}px`,
      }}
    >
      {previewItems}
      <div className={`${styles.previewMode} ${modeClassName}`}>
        {operationMode !== OperationMode.DRAGGING && (
          <kbd className={styles.key}>V</kbd>
        )}
        {modeString}
      </div>
    </div>
  );
}
