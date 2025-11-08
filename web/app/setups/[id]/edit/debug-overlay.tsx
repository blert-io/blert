'use client';

import { useContext } from 'react';

import { OperationMode, SetupEditingContext } from '../../editing-context';

import styles from './debug-overlay.module.scss';

export default function DebugOverlay() {
  const context = useContext(SetupEditingContext);
  if (context === null) {
    return null;
  }

  const {
    operationMode,
    selection,
    clipboard,
    selectedItem,
    activeSearchSlot,
    placementOffset,
  } = context;

  const modeLabels: Record<OperationMode, string> = {
    [OperationMode.ITEM_PLACEMENT]: 'Item Placement',
    [OperationMode.SELECTING]: 'Selecting',
    [OperationMode.SELECTION]: 'Selection',
    [OperationMode.DRAGGING]: 'Dragging',
    [OperationMode.CLIPBOARD_CUT]: 'Clipboard Cut',
    [OperationMode.CLIPBOARD_COPY]: 'Clipboard Copy',
  };

  const modeColors: Record<OperationMode, string> = {
    [OperationMode.ITEM_PLACEMENT]: '#888',
    [OperationMode.SELECTING]: '#5865F2',
    [OperationMode.SELECTION]: '#59B8F6',
    [OperationMode.DRAGGING]: '#DEC888',
    [OperationMode.CLIPBOARD_CUT]: '#EF4444',
    [OperationMode.CLIPBOARD_COPY]: '#2DC770',
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.header}>Debug State</div>

      <div className={styles.section}>
        <div className={styles.label}>Mode:</div>
        <div
          className={styles.value}
          style={{ color: modeColors[operationMode] }}
        >
          {modeLabels[operationMode]}
        </div>
      </div>

      {selectedItem !== null && (
        <div className={styles.section}>
          <div className={styles.label}>Selected Item:</div>
          <div className={styles.value}>
            {selectedItem.name} ({selectedItem.id})
          </div>
        </div>
      )}

      {selection !== null && (
        <div className={styles.section}>
          <div className={styles.label}>Selection:</div>
          <div className={styles.value}>
            {selection.type} - {selection.slots.size} slot
            {selection.slots.size !== 1 ? 's' : ''}
          </div>
          <div className={styles.subValue}>
            {selection.bounds.width}x{selection.bounds.height} (container{' '}
            {selection.bounds.container}, player {selection.bounds.playerIndex})
          </div>
          {placementOffset !== null && (
            <div className={styles.subValue}>
              Offset: {placementOffset[0]}, {placementOffset[1]}
            </div>
          )}
        </div>
      )}

      {clipboard !== null && (
        <div className={styles.section}>
          <div className={styles.label}>Clipboard:</div>
          <div className={styles.value}>
            {clipboard.operation} - {clipboard.region.slots.size} slot
            {clipboard.region.slots.size !== 1 ? 's' : ''}
          </div>
          <div className={styles.subValue}>Mode: {clipboard.pasteMode}</div>
        </div>
      )}

      {activeSearchSlot !== null && (
        <div className={styles.section}>
          <div className={styles.label}>Active Search:</div>
          <div className={styles.value}>{activeSearchSlot}</div>
        </div>
      )}
    </div>
  );
}
