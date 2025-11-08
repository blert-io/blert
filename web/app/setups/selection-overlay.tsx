'use client';

import { useContext } from 'react';

import { coordsToIndex, getContainerDimensions } from './container-grid';
import { OperationMode, SetupEditingContext } from './editing-context';
import { Container } from './setup';

import styles from './selection-overlay.module.scss';

type SelectionOverlayProps = {
  container: Container;
  playerIndex: number;
};

export default function SelectionOverlay({
  container,
  playerIndex,
}: SelectionOverlayProps) {
  const context = useContext(SetupEditingContext);
  if (context === null) {
    return null;
  }

  const { selection, operationMode } = context;
  if (selection === null) {
    return null;
  }

  // Hide existing selection while creating a new one.
  if (operationMode === OperationMode.SELECTING) {
    return null;
  }

  // Only show selection overlay for this container and player.
  if (
    selection.bounds.container !== container ||
    selection.bounds.playerIndex !== playerIndex
  ) {
    return null;
  }

  const { cols, rows } = getContainerDimensions(container);

  const selectedSlots: React.ReactElement[] = [];
  for (const [key, slotData] of selection.slots) {
    const gridX = selection.bounds.minX + slotData.localX;
    const gridY = selection.bounds.minY + slotData.localY;

    const index = coordsToIndex(gridX, gridY, container);
    if (index === null) {
      continue;
    }

    let className = styles.selectedSlot;

    if (operationMode === OperationMode.CLIPBOARD_CUT) {
      className += ` ${styles.cut}`;
    } else if (operationMode === OperationMode.CLIPBOARD_COPY) {
      className += ` ${styles.copy}`;
    }

    selectedSlots.push(
      <div
        key={key}
        className={className}
        style={{
          gridColumn: gridX + 1,
          gridRow: gridY + 1,
        }}
      />,
    );
  }

  return (
    <div
      className={styles.overlay}
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {selectedSlots}
    </div>
  );
}
