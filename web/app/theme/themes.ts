export type ThemeId = 'blert';

export type ThemeDefinition = {
  id: ThemeId;
  label: string;
  description: string;
};

/**
 * Available themes, in display order.
 *
 * Adding a theme is a matter of appending an entry here plus a matching
 * `[data-theme='<id>']` token block in `globals.scss`.
 */
export const THEMES: ThemeDefinition[] = [
  { id: 'blert', label: 'Blert', description: 'The classic Blert look.' },
];

export const DEFAULT_THEME: ThemeId = 'blert';

/** The user settings key under which the chosen theme is stored. */
export const THEME_SETTING_KEY = 'appearance.theme';

/** Coerces an arbitrary stored value to a known theme id. */
export function resolveThemeId(value: unknown): ThemeId {
  return THEMES.some((theme) => theme.id === value)
    ? (value as ThemeId)
    : DEFAULT_THEME;
}
