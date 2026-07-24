/**
 * Decorative, themed colors for the canvas timeline.
 * Only a subset of colors are themeable, as colors which encode semantic
 * meaning should stay consistent.
 */
export type TimelinePalette = {
  /** Background for an empty cell. */
  cellBgDefault: string;
  cellBgDefaultHover: string;
  /** Background for a cell whose player performed an action this tick. */
  cellBgAction: string;
  /**
   * Hover border for a cell with an action.
   * Overriden by an evaluator's styling.
   */
  cellBgActionHover: string;
  /** Background for a cell where the player was off cooldown but idle. */
  cellBgOffCooldown: string;
  cellBgOffCooldownHover: string;
  /** Neutral (non-evaluated) cell outline. */
  outlineNeutral: string;
  outlineNeutralHover: string;
  /** Outline drawn on any hovered cell without a more specific outline. */
  outlineHover: string;
  /** Tick number in the column header. */
  textTickHeader: string;
  /** Default label / letter text. */
  textPrimary: string;
  /**
   * The theme's accent, equivalent to `blert-purple` in the default theme.
   */
  blertAccent: string;
};

/**
 * Reads a CSS custom property value by name, e.g. `--blert-timeline-accent`.
 */
export type ColorReader = (name: string) => string;

/**
 * Builds the timeline's decorative palette from the app's CSS tokens.
 *
 * Each color is a single `--blert-timeline-*` custom property holding its final
 * value, so reading tokens keeps the timeline in sync with the active theme.
 *
 * @param read Optional custom property reader. Defaults to the computed style
 *   of the document root.
 */
export function buildTimelinePalette(read?: ColorReader): TimelinePalette {
  if (read === undefined) {
    if (typeof window === 'undefined') {
      read = () => '';
    } else {
      const styles = getComputedStyle(document.documentElement);
      read = (name) => styles.getPropertyValue(name);
    }
  }

  const color = (name: string): string => {
    return read(name).trim();
  };

  return {
    cellBgDefault: color('--blert-timeline-cell-bg-default'),
    cellBgDefaultHover: color('--blert-timeline-cell-bg-default-hover'),
    cellBgAction: color('--blert-timeline-cell-bg-action'),
    cellBgActionHover: color('--blert-timeline-cell-bg-action-hover'),
    cellBgOffCooldown: color('--blert-timeline-cell-bg-off-cooldown'),
    cellBgOffCooldownHover: color(
      '--blert-timeline-cell-bg-off-cooldown-hover',
    ),
    outlineNeutral: color('--blert-timeline-outline-neutral'),
    outlineNeutralHover: color('--blert-timeline-outline-neutral-hover'),
    outlineHover: color('--blert-timeline-outline-hover'),
    textTickHeader: color('--blert-timeline-text-tick-header'),
    textPrimary: color('--blert-timeline-text-primary'),
    blertAccent: color('--blert-timeline-accent'),
  };
}
