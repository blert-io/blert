export type EntityType = 'player' | 'npc';

export interface Entity {
  x: number;
  y: number;
  type: EntityType;
  size: number;

  /** Renders the internal contents of an entity displayed on a map. */
  renderContents(): React.ReactNode;
}
