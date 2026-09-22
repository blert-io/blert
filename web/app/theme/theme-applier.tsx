'use client';

import { useEffect } from 'react';

import { useSettingsContext } from '@/components/settings-provider';

import { resolveThemeId, THEME_SETTING_KEY } from './themes';

/** Keeps `<html data-theme>` in sync with the persisted theme setting. */
export default function ThemeApplier() {
  const { settings, isLoading } = useSettingsContext();

  useEffect(() => {
    // Until a theme is known to have been chosen, the attribute set by the
    // pre-paint script is left untouched to avoid replacing the existing theme
    // with the default.
    if (isLoading) {
      return;
    }
    const stored = settings[THEME_SETTING_KEY];
    if (stored === undefined) {
      return;
    }
    document.documentElement.dataset.theme = resolveThemeId(stored);
  }, [settings, isLoading]);

  return null;
}
