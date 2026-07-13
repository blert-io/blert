'use client';

import { useEffect } from 'react';

import { useSettingsContext } from '@/components/settings-provider';

import { DEFAULT_THEME, resolveThemeId, THEME_SETTING_KEY } from './themes';

/** Keeps `<html data-theme>` in sync with the persisted theme setting. */
export default function ThemeApplier() {
  const { settings, isLoading } = useSettingsContext();

  useEffect(() => {
    // While the settings context is loading, the attribute set by the pre-paint
    // script is left untouched, as the unpopulated settings would resolve back
    // to the default theme.
    if (isLoading) {
      return;
    }
    const resolved = resolveThemeId(settings[THEME_SETTING_KEY]);
    if (resolved === DEFAULT_THEME) {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = resolved;
    }
  }, [settings, isLoading]);

  return null;
}
