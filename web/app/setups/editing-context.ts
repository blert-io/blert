import { Dispatch, SetStateAction, createContext } from 'react';

import {
  ExtendedItemData,
  extendedItemCache,
} from '@/utils/item-cache/extended';

import {
  Container,
  GearSetup,
  GearSetupPlayer,
  getContainerKey,
  ItemSlot,
  SlotItem,
} from './setup';
import { PlacementMode, PlacementTarget, placeRegion } from './container-grid';

/**
 * Operation modes for the editing context.
 * Only one mode can be active at a time.
 */
export enum OperationMode {
  /** Default mode: placing single items. */
  ITEM_PLACEMENT = 'item_placement',
  /** Creating/modifying selection via drag. */
  SELECTING = 'selecting',
  /** Items are selected but no operation is active. */
  SELECTION = 'selection',
  /** Actively dragging selection. */
  DRAGGING = 'dragging',
  /** Selection has been cut (Ctrl+X). */
  CLIPBOARD_CUT = 'clipboard_cut',
  /** Selection has been copied (Ctrl+C). */
  CLIPBOARD_COPY = 'clipboard_copy',
}

/**
 * Identifier for a specific slot in the setup.
 */
export interface SlotIdentifier {
  playerIndex: number;
  container: Container;
  index: number;
}

/**
 * Data for a single slot in a selection region.
 */
export interface SlotData {
  slot: ItemSlot | null;
  localX: number;
  localY: number;
  slotId: SlotIdentifier;
}

export type SlotKey = `${number},${number}`;

/**
 * A region of selected slots.
 * Can be dense (rectangular) or sparse (individual slots).
 */
export interface SelectionRegion {
  type: 'dense' | 'sparse';
  bounds: {
    minX: number;
    minY: number;
    width: number;
    height: number;
    container: Container;
    playerIndex: number;
  };
  slots: Map<SlotKey, SlotData>;
}

export type EditableGearSetup = {
  history: GearSetup[];
  position: number;
  modified: boolean;
  selectedItem: number | null;
  activeSearchSlot: string | null;
  operationMode: OperationMode;
  selection: SelectionRegion | null;
  clipboard: {
    region: SelectionRegion;
    operation: 'cut' | 'copy';
    pasteMode: PlacementMode;
  } | null;
  placementHoverTarget: PlacementTarget | null;
  placementOffset: [number, number] | null;
};

export const SetupEditingContext = createContext<EditingContext | null>(null);

export class EditingContext {
  private setupId: string;
  private state: EditableGearSetup;
  private setState: Dispatch<SetStateAction<EditableGearSetup>>;

  constructor(
    setupId: string,
    state: EditableGearSetup,
    setState: Dispatch<SetStateAction<EditableGearSetup>>,
  ) {
    this.setupId = setupId;
    this.state = state;
    this.setState = setState;
  }

  public static newEditableGearSetup(setup: GearSetup): EditableGearSetup {
    return {
      history: [setup],
      position: 0,
      modified: false,
      selectedItem: null,
      activeSearchSlot: null,
      operationMode: OperationMode.ITEM_PLACEMENT,
      selection: null,
      clipboard: null,
      placementHoverTarget: null,
      placementOffset: null,
    };
  }

  public get modified() {
    return this.state.modified;
  }

  public get setup() {
    return this.state.history[this.state.position];
  }

  public get selectedItem(): ExtendedItemData | null {
    if (this.state.selectedItem === null) {
      return null;
    }
    return extendedItemCache.getItem(this.state.selectedItem);
  }

  public setSelectedItem(id: number | null) {
    this.changeMode(OperationMode.ITEM_PLACEMENT, { selectedItem: id });
  }

  public get activeSearchSlot(): string | null {
    return this.state.activeSearchSlot;
  }

  public setActiveSearchSlot(id: string | null) {
    this.setState((prev) => ({ ...prev, activeSearchSlot: id }));
  }

  public get operationMode(): OperationMode {
    return this.state.operationMode;
  }

  public get selection(): SelectionRegion | null {
    return this.state.selection;
  }

  public get clipboard() {
    return this.state.clipboard;
  }

  public get isPlacementMode(): boolean {
    return (
      this.operationMode === OperationMode.DRAGGING ||
      this.operationMode === OperationMode.CLIPBOARD_CUT ||
      this.operationMode === OperationMode.CLIPBOARD_COPY
    );
  }

  /**
   * Sets the operation mode and updates related state.
   * Handles mode transitions (e.g., clearing selection when switching to item placement).
   */
  public setOperationMode(mode: OperationMode) {
    this.changeMode(mode);
  }

  /**
   * Sets the current selection region.
   */
  public setSelection(region: SelectionRegion | null) {
    if (region === null) {
      this.changeMode(OperationMode.ITEM_PLACEMENT);
    } else {
      this.changeMode(OperationMode.SELECTION, { selection: region });
    }
  }

  /**
   * Clears the current selection and returns to item placement mode.
   */
  public clearSelection() {
    this.setSelection(null);
  }

  /**
   * Removes all slots in the current selection from its container.
   */
  public deleteSelection() {
    this.setState((prev) => {
      if (prev.selection === null) {
        return prev;
      }

      let hasSlots = false;

      const indices = new Set<number>();
      for (const [_, slot] of prev.selection.slots) {
        indices.add(slot.slotId.index);
        if (slot.slot !== null) {
          hasSlots = true;
        }
      }

      if (!hasSlots) {
        // Don't create a new history entry with an empty selection.
        return {
          ...prev,
          ...this.modeTransitions(
            prev.operationMode,
            OperationMode.ITEM_PLACEMENT,
          ),
        };
      }

      const cloned = structuredClone(prev.history[prev.position]);
      const containerKey = getContainerKey(prev.selection.bounds.container);
      const newPlayer = cloned.players[prev.selection.bounds.playerIndex];
      newPlayer[containerKey].slots = newPlayer[containerKey].slots.filter(
        (slot) => !indices.has(slot.index),
      );

      return {
        ...prev,
        history: [...prev.history.slice(0, prev.position + 1), cloned],
        position: prev.position + 1,
        modified: true,
        ...this.modeTransitions(
          prev.operationMode,
          OperationMode.ITEM_PLACEMENT,
        ),
      };
    });
  }

  /**
   * Gets the current placement hover target.
   */
  public get placementHoverTarget() {
    return this.state.placementHoverTarget;
  }

  /**
   * Gets the current placement offset.
   */
  public get placementOffset(): [number, number] | null {
    return this.state.placementOffset;
  }

  /**
   * Sets the placement hover target.
   */
  public setPlacementHoverTarget(
    container: Container,
    playerIndex: number,
    gridCoords: [number, number],
  ) {
    this.setState((prev) => {
      // Only update if the grid coordinates actually changed.
      const current = prev.placementHoverTarget;
      if (
        current &&
        current.container === container &&
        current.playerIndex === playerIndex &&
        current.gridCoords[0] === gridCoords[0] &&
        current.gridCoords[1] === gridCoords[1]
      ) {
        return prev;
      }

      return {
        ...prev,
        placementHoverTarget: { container, playerIndex, gridCoords },
      };
    });
  }

  /**
   * Clears the placement hover target.
   */
  public clearPlacementHoverTarget() {
    this.setState((prev) => ({
      ...prev,
      placementHoverTarget: null,
    }));
  }

  /**
   * Starts a drag operation from the specified container.
   * @param offset Offset into the selection from which the drag was started
   * in grid coordinates.
   */
  public startDrag(offset: [number, number]) {
    this.changeMode(OperationMode.DRAGGING, { placementOffset: offset });
  }
  /**
   * Ends the active drag operation without making changes.
   */
  public cancelDrag() {
    this.setState((prev) => ({
      ...prev,
      placementHoverTarget: null,
      operationMode: OperationMode.SELECTION,
    }));
  }

  /**
   * Completes a drag operation by swapping regions.
   * @param targetContainer Container to drop into
   * @param targetPlayerIndex Player index to drop into
   * @param targetGridCoords Grid coordinates in target container
   */
  public completeDrag(
    targetContainer: Container,
    targetPlayerIndex: number,
    targetGridCoords: [number, number],
  ) {
    this.setState((prev) => {
      if (
        prev.operationMode !== OperationMode.DRAGGING ||
        prev.selection === null
      ) {
        return prev;
      }

      const { selection } = prev;
      const target: PlacementTarget = {
        container: targetContainer,
        playerIndex: targetPlayerIndex,
        gridCoords: targetGridCoords,
      };
      const players = prev.history[prev.position].players;

      const result = placeRegion(
        selection,
        target,
        players[targetPlayerIndex],
        players[selection.bounds.playerIndex],
        PlacementMode.SWAP,
        true,
        prev.placementOffset,
      );

      let updates: Partial<EditableGearSetup> = {};

      if (result !== null) {
        const [updatedTarget, updatedSource, newRegion] = result;
        const cloned = structuredClone(prev.history[prev.position]);
        cloned.players[targetPlayerIndex] = updatedTarget;
        cloned.players[selection.bounds.playerIndex] = updatedSource;

        updates.history = [...prev.history.slice(0, prev.position + 1), cloned];
        updates.position = prev.position + 1;
        updates.modified = true;
        updates.selection = newRegion;
      }

      return {
        ...prev,
        ...updates,
        ...this.modeTransitions(prev.operationMode, OperationMode.SELECTION),
      };
    });
  }

  public applyClipboard(
    targetContainer: Container,
    targetPlayerIndex: number,
    targetGridCoords: [number, number],
  ) {
    this.setState((prev) => {
      if (
        prev.operationMode !== OperationMode.CLIPBOARD_CUT &&
        prev.operationMode !== OperationMode.CLIPBOARD_COPY
      ) {
        return prev;
      }
      if (prev.clipboard === null) {
        return prev;
      }

      const { region, operation, pasteMode } = prev.clipboard;

      const target: PlacementTarget = {
        container: targetContainer,
        playerIndex: targetPlayerIndex,
        gridCoords: targetGridCoords,
      };
      const players = prev.history[prev.position].players;

      const result = placeRegion(
        region,
        target,
        players[targetPlayerIndex],
        players[region.bounds.playerIndex],
        pasteMode,
        operation === 'cut',
        prev.placementOffset,
      );

      let updates: Partial<EditableGearSetup> = {};
      let newMode: OperationMode;

      if (result !== null) {
        const [updatedTarget, updatedSource, newRegion] = result;
        const cloned = structuredClone(prev.history[prev.position]);
        cloned.players[targetPlayerIndex] = updatedTarget;
        cloned.players[region.bounds.playerIndex] = updatedSource;

        updates.history = [...prev.history.slice(0, prev.position + 1), cloned];
        updates.position = prev.position + 1;
        updates.modified = true;

        if (operation === 'cut') {
          // End a cut with the new region selected.
          newMode = OperationMode.SELECTION;
          updates.selection = newRegion;
        } else {
          // In a copy, keep the original selection so it can be pasted again.
          newMode = OperationMode.CLIPBOARD_COPY;
        }
      } else {
        newMode = OperationMode.SELECTION;
      }

      return {
        ...prev,
        ...updates,
        ...this.modeTransitions(prev.operationMode, newMode),
      };
    });
  }

  /**
   * Copies the current selection to the clipboard.
   */
  public copySelection() {
    this.setState((prev) => {
      if (prev.selection === null) {
        return prev;
      }
      return {
        ...prev,
        ...this.modeTransitions(
          prev.operationMode,
          OperationMode.CLIPBOARD_COPY,
        ),
        clipboard: {
          region: structuredClone(prev.selection),
          operation: 'copy',
          pasteMode: PlacementMode.REPLACE,
        },
        placementOffset: [
          Math.floor(prev.selection.bounds.width / 2),
          Math.floor(prev.selection.bounds.height / 2),
        ],
      };
    });
  }

  /**
   * Cuts the current selection to the clipboard.
   */
  public cutSelection() {
    this.setState((prev) => {
      if (prev.selection === null) {
        return prev;
      }
      return {
        ...prev,
        ...this.modeTransitions(
          prev.operationMode,
          OperationMode.CLIPBOARD_CUT,
        ),
        clipboard: {
          region: structuredClone(prev.selection),
          operation: 'cut',
          pasteMode: PlacementMode.REPLACE,
        },
        placementOffset: [
          Math.floor(prev.selection.bounds.width / 2),
          Math.floor(prev.selection.bounds.height / 2),
        ],
      };
    });
  }

  /**
   * With an active clipboard, cycles the paste mode between REPLACE and MERGE.
   */
  public cycleClipboardMode() {
    this.setState((prev) => {
      if (prev.clipboard === null) {
        return prev;
      }
      return {
        ...prev,
        clipboard: {
          ...prev.clipboard,
          pasteMode:
            prev.clipboard.pasteMode === PlacementMode.REPLACE
              ? PlacementMode.MERGE
              : PlacementMode.REPLACE,
        },
      };
    });
  }

  /**
   * Updates the current gear setup state.
   * @param updater Function that modifies the gear setup.
   */
  public update(updater: (prev: GearSetup) => GearSetup) {
    this.setState((prev) => {
      const cloned = structuredClone(prev.history[prev.position]);
      const updated = updater(cloned);
      return {
        ...prev,
        history: [...prev.history.slice(0, prev.position + 1), updated],
        position: prev.position + 1,
        modified: true,
      };
    });
  }

  /**
   * Modifies a player in the current gear setup.
   * @param playerIndex Index of the player.
   * @param updater Function that modifies the player.
   */
  public updatePlayer(
    playerIndex: number,
    updater: (prev: GearSetupPlayer) => GearSetupPlayer,
  ) {
    this.update((prev) => {
      if (playerIndex < 0 || playerIndex >= prev.players.length) {
        return prev;
      }
      const cloned = structuredClone(prev);
      cloned.players[playerIndex] = updater(cloned.players[playerIndex]);
      return cloned;
    });
  }

  /** Reverts to the previous gear setup state. */
  public undo() {
    this.setState((prev) => {
      if (prev.position === 0) {
        return prev;
      }
      return {
        ...prev,
        position: prev.position - 1,
        modified: true,
        // TODO(frolv): Preserve selection/clipboard state.
        // Temporarily switch to placement to not end up with a weird selection.
        ...this.modeTransitions(
          prev.operationMode,
          OperationMode.ITEM_PLACEMENT,
        ),
      };
    });
  }

  /** Moves to the next gear setup state, if previously undone. */
  public redo() {
    this.setState((prev) => {
      if (prev.position === prev.history.length - 1) {
        return prev;
      }
      return {
        ...prev,
        position: prev.position + 1,
        modified: true,
        // TODO(frolv): Preserve selection/clipboard state.
        // Temporarily switch to placement to not end up with a weird selection.
        ...this.modeTransitions(
          prev.operationMode,
          OperationMode.ITEM_PLACEMENT,
        ),
      };
    });
  }

  /** Clears the modified flag. */
  public clearModified() {
    this.setState((prev) => ({ ...prev, modified: false }));
  }

  /**
   * Handles the transition to a new operation mode.
   * @param newMode The new operation mode.
   * @param extraUpdates Extra updates to apply to the state.
   */
  private changeMode(
    newMode: OperationMode,
    extraUpdates: Partial<EditableGearSetup> = {},
  ): void {
    this.setState((prev) => {
      const modeUpdates = this.modeTransitions(prev.operationMode, newMode);
      return { ...prev, ...modeUpdates, ...extraUpdates };
    });
  }

  private modeTransitions(
    oldMode: OperationMode,
    newMode: OperationMode,
  ): Partial<EditableGearSetup> {
    const modeUpdates: Partial<EditableGearSetup> = {
      operationMode: newMode,
      placementOffset: null,
    };

    // Handle mode transitions
    if (newMode === OperationMode.ITEM_PLACEMENT) {
      modeUpdates.selection = null;
      modeUpdates.clipboard = null;
      modeUpdates.placementHoverTarget = null;
    } else if (
      newMode === OperationMode.SELECTION ||
      newMode === OperationMode.SELECTING
    ) {
      if (
        oldMode === OperationMode.CLIPBOARD_CUT ||
        oldMode === OperationMode.CLIPBOARD_COPY
      ) {
        modeUpdates.clipboard = null;
      }
      modeUpdates.selectedItem = null;
      modeUpdates.placementHoverTarget = null;
    }

    return modeUpdates;
  }
}
