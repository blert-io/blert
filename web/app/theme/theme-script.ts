import { SETTINGS_KEY_PREFIX } from '@/utils/settings';

import { DEFAULT_THEME, THEME_SETTING_KEY } from './themes';

const STORAGE_KEY = SETTINGS_KEY_PREFIX + THEME_SETTING_KEY;

/**
 * Inline script that runs before first paint, reading the persisted theme from
 * localStorage and sets `data-theme` on `<html>`, so the initial render is
 * appropriately themed.
 */
export const THEME_INIT_SCRIPT = `(function () {
  try {
    var raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    if (raw === null) return;
    var theme = JSON.parse(raw);
    if (typeof theme === 'string' && theme !== ${JSON.stringify(DEFAULT_THEME)}) {
      document.documentElement.dataset.theme = theme;
    }
  } catch (e) {}
})();`;
