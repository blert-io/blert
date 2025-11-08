'use client';

import React, {
  useContext,
  useRef,
  useState,
  useEffect,
  useCallback,
} from 'react';

import {
  coordsToIndex,
  eventToGridCoords,
  SLOT_SIZE_PX,
} from './container-grid';
import {
  OperationMode,
  SetupEditingContext,
  SelectionRegion,
  SlotData,
  SlotIdentifier,
  SlotKey,
} from './editing-context';
import { PlacementPreview } from './placement-preview';
import SelectionOverlay from './selection-overlay';
import {
  Container,
  GearSetupPlayer,
  ItemSlot,
  QUIVER_SLOT_INDEX,
  getContainer,
  hasQuiver,
} from './setup';

import styles from './selectable-container.module.scss';

type SelectableContainerProps = {
  container: Container;
  playerIndex: number;
  children: React.ReactNode;
  className?: string;
};

type DragStart = {
  coords: [number, number];
  isItem: boolean;
};

function isWithinSelection(
  x: number,
  y: number,
  container: Container,
  playerIndex: number,
  selection: SelectionRegion | null,
): boolean {
  if (selection === null) {
    return false;
  }

  if (
    selection.bounds.container !== container ||
    selection.bounds.playerIndex !== playerIndex
  ) {
    return false;
  }

  const localX = x - selection.bounds.minX;
  const localY = y - selection.bounds.minY;

  return selection.slots.has(`${localX},${localY}`);
}

/**
 * Wraps a container element to add drag selection functionality.
 */
export function SelectableContainer({
  container,
  playerIndex,
  children,
  className = '',
}: SelectableContainerProps) {
  const context = useContext(SetupEditingContext);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<DragStart | null>(null);
  const [dragCurrent, setDragCurrent] = useState<[number, number] | null>(null);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const dragThresholdMet = useRef(false);

  // Only enable selection if we're in editing mode.
  if (context === null) {
    return <div className={className}>{children}</div>;
  }

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) {
        return;
      }

      if (
        context.operationMode === OperationMode.ITEM_PLACEMENT &&
        context.selectedItem !== null &&
        !e.shiftKey
      ) {
        return;
      }

      const containerElement = containerRef.current;
      if (containerElement === null) {
        return;
      }

      const coords = eventToGridCoords(e, containerElement, container);
      if (coords === null) {
        return;
      }

      const isItem =
        e.target instanceof HTMLDivElement &&
        e.target.closest('[data-slot-item]') !== null;

      // Store the mouse down position and grid coordinates.
      mouseDownPos.current = { x: e.clientX, y: e.clientY };
      dragThresholdMet.current = false;
      setDragStart({ coords, isItem });
      setDragCurrent(coords);
    },
    [context, container],
  );

  const setHoverCoords = useCallback(
    (coords: [number, number] | null) => {
      if (coords !== null) {
        context.setPlacementHoverTarget(container, playerIndex, coords);
      } else {
        const current = context.placementHoverTarget;
        if (
          current &&
          current.container === container &&
          current.playerIndex === playerIndex
        ) {
          context.clearPlacementHoverTarget();
        }
      }
    },
    [context, container, playerIndex],
  );

  useEffect(() => {
    // Set up event listeners for a potential drag.
    if (dragStart === null) {
      return;
    }

    const DRAG_THRESHOLD_PX = 5;

    const handleMouseMove = (e: MouseEvent) => {
      if (mouseDownPos.current === null) {
        return;
      }

      if (!dragThresholdMet.current) {
        // Check if the cursor has moved enough to start a new drag operation.
        const dx = Math.abs(e.clientX - mouseDownPos.current.x);
        const dy = Math.abs(e.clientY - mouseDownPos.current.y);

        if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) {
          dragThresholdMet.current = true;
          setIsDragging(true);

          const inSelection = isWithinSelection(
            dragStart.coords[0],
            dragStart.coords[1],
            container,
            playerIndex,
            context.selection,
          );
          if (inSelection && !e.shiftKey) {
            // Dragging an existing selection.
            const offset: [number, number] = [
              dragStart.coords[0] - (context.selection?.bounds.minX ?? 0),
              dragStart.coords[1] - (context.selection?.bounds.minY ?? 0),
            ];
            context.startDrag(offset);
            setHoverCoords(dragStart.coords);
          } else {
            // Starting a new selection.
            if (dragStart.isItem && !e.shiftKey) {
              // If starting the drag from an occupied item slot, automatically
              // create a 1x1 selection region and begin dragging.
              // Holding shift overrides this behavior and allows marquee
              // selection.
              const selection = createDragSelection(
                dragStart.coords,
                dragStart.coords,
                container,
                playerIndex,
                context.setup.players[playerIndex],
              );
              if (selection !== null) {
                context.setSelection(selection);
                context.startDrag([0, 0]);
                setHoverCoords(dragStart.coords);
              } else {
                context.clearSelection();
              }
            } else {
              context.setOperationMode(OperationMode.SELECTING);
            }
          }
        }
      }

      // Handle selection drag locally within the container.
      if (
        dragThresholdMet.current &&
        context.operationMode === OperationMode.SELECTING
      ) {
        e.preventDefault();

        const containerElement = containerRef.current;
        if (containerElement === null) {
          return;
        }

        const coords = eventToGridCoords(
          e as unknown as React.MouseEvent,
          containerElement,
          container,
        );
        if (coords !== null) {
          setDragCurrent(coords);
        }
      }
    };

    const handleLocalMouseUp = () => {
      if (
        dragThresholdMet.current &&
        context.operationMode === OperationMode.SELECTING &&
        dragStart !== null &&
        dragCurrent !== null
      ) {
        const selection = createDragSelection(
          dragStart.coords,
          dragCurrent,
          container,
          playerIndex,
          context.setup.players[playerIndex],
        );

        if (selection !== null) {
          context.setSelection(selection);
        } else {
          context.clearSelection();
        }
      }

      // Reset the local drag state.
      setIsDragging(false);
      setDragStart(null);
      setDragCurrent(null);
      mouseDownPos.current = null;
      dragThresholdMet.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleLocalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleLocalMouseUp);
    };
  }, [dragStart, dragCurrent, container, playerIndex, context, setHoverCoords]);

  let marquee: React.ReactElement | null = null;
  if (
    isDragging &&
    context.operationMode === OperationMode.SELECTING &&
    dragStart !== null &&
    dragCurrent !== null
  ) {
    const { coords: startCoords } = dragStart;
    const minX = Math.min(startCoords[0], dragCurrent[0]);
    const maxX = Math.max(startCoords[0], dragCurrent[0]);
    const minY = Math.min(startCoords[1], dragCurrent[1]);
    const maxY = Math.max(startCoords[1], dragCurrent[1]);

    marquee = (
      <div
        className={styles.marquee}
        style={{
          left: `${minX * SLOT_SIZE_PX}px`,
          top: `${minY * SLOT_SIZE_PX}px`,
          width: `${(maxX - minX + 1) * SLOT_SIZE_PX}px`,
          height: `${(maxY - minY + 1) * SLOT_SIZE_PX}px`,
        }}
      />
    );
  }

  const isPlacementMode = context.isPlacementMode;

  const handleContainerMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      if (isPlacementMode) {
        const coords = eventToGridCoords(e, containerRef.current!, container);
        setHoverCoords(coords);
      }
    },
    [isPlacementMode, container, setHoverCoords],
  );

  const handleContainerMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPlacementMode) {
        const coords = eventToGridCoords(e, containerRef.current!, container);
        if (coords !== null) {
          setHoverCoords(coords);
        }
      }
    },
    [isPlacementMode, container, setHoverCoords],
  );

  const handleContainerMouseLeave = useCallback(() => {
    if (isPlacementMode) {
      setHoverCoords(null);
    }
  }, [isPlacementMode, setHoverCoords]);

  const containerIdData = `${container}-${playerIndex}`;

  return (
    <div
      ref={containerRef}
      className={`${className} ${styles.selectableContainer}`}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleContainerMouseEnter}
      onMouseMove={handleContainerMouseMove}
      onMouseLeave={handleContainerMouseLeave}
      data-container-id={containerIdData}
      data-container-type={container}
      data-player-index={playerIndex}
    >
      {children}
      {context && (
        <>
          <SelectionOverlay container={container} playerIndex={playerIndex} />
          <PlacementPreview container={container} playerIndex={playerIndex} />
        </>
      )}
      {marquee}
    </div>
  );
}

/**
 * Creates a selection region from drag start and end coordinates.
 *
 * @param start The starting grid coordinates of the drag.
 * @param end The ending grid coordinates of the drag.
 * @param container Container for which to create the selection.
 * @param playerIndex Index of the player for which to create the selection.
 * @param player Player for whom to create the selection.
 * @returns Selection region or null if the selection is invalid.
 */
function createDragSelection(
  start: [number, number],
  end: [number, number],
  container: Container,
  playerIndex: number,
  player: GearSetupPlayer,
): SelectionRegion | null {
  const minX = Math.min(start[0], end[0]);
  const maxX = Math.max(start[0], end[0]);
  const minY = Math.min(start[1], end[1]);
  const maxY = Math.max(start[1], end[1]);

  const slots = new Map<SlotKey, SlotData>();
  let hasNullSlots = false;

  const containerSlots = getContainer(player, container);
  const slotsByIndex = new Map<number, ItemSlot>();
  for (const slot of containerSlots) {
    slotsByIndex.set(slot.index, slot);
  }

  // Check every slot in the selection region.
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const index = coordsToIndex(x, y, container);
      if (index === null) {
        hasNullSlots = true;
        continue;
      }

      if (
        container === Container.EQUIPMENT &&
        index === QUIVER_SLOT_INDEX &&
        !hasQuiver(player)
      ) {
        hasNullSlots = true;
        continue;
      }

      const slotId: SlotIdentifier = {
        playerIndex,
        container,
        index,
      };

      const slotData: SlotData = {
        slot: slotsByIndex.get(index) ?? null,
        localX: x - minX,
        localY: y - minY,
        slotId,
      };

      slots.set(`${slotData.localX},${slotData.localY}`, slotData);
    }
  }

  if (slots.size === 0) {
    return null;
  }

  return {
    type: hasNullSlots ? 'sparse' : 'dense',
    bounds: {
      minX,
      minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      container,
      playerIndex,
    },
    slots,
  };
}
