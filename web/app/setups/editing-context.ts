import { Dispatch, SetStateAction, createContext } from 'react';

import {
  ExtendedItemData,
  extendedItemCache,
} from '@/utils/item-cache/extended';

import { GearSetup, GearSetupPlayer } from './setup';

export type EditableGearSetup = {
  history: GearSetup[];
  position: number;
  modified: boolean;
  selectedItem: number | null;
};

export const SetupEditingContext = createContext<EditingContext | null>(null);

export class EditingContext {
  private state: EditableGearSetup;
  private setState: Dispatch<SetStateAction<EditableGearSetup>>;

  constructor(
    state: EditableGearSetup,
    setState: Dispatch<SetStateAction<EditableGearSetup>>,
  ) {
    this.state = state;
    this.setState = setState;
  }

  public static newEditableGearSetup(setup: GearSetup): EditableGearSetup {
    return {
      history: [setup],
      position: 0,
      modified: false,
      selectedItem: null,
    };
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
    this.setState((prev) =>
      id === prev.selectedItem ? prev : { ...prev, selectedItem: id },
    );
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
      return { ...prev, position: prev.position - 1, modified: true };
    });
  }

  /** Moves to the next gear setup state, if previously undone. */
  public redo() {
    this.setState((prev) => {
      if (prev.position === prev.history.length - 1) {
        return prev;
      }
      return { ...prev, position: prev.position + 1, modified: true };
    });
  }

  public save() {
    this.setState((prev) => {
      return { ...prev, modified: false };
    });
  }
}
