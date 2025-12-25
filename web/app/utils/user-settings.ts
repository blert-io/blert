'use client';

import { useCallback, useRef } from 'react';

import { useSettingsContext } from '@/components/settings-provider';

type UseSettingOptions<T> = {
  key: string;
  defaultValue: T;
};

/**
 * Hook for persisting user settings.
 *
 * For authenticated users, settings are synced to the server.
 * For unauthenticated users, settings are stored in localStorage.
 *
 * @param key The settings key.
 * @param defaultValue The default value (captured on first render).
 * @returns A tuple of the current value and a function to update the value.
 */
export function useSetting<T>({
  key,
  defaultValue,
}: UseSettingOptions<T>): [T, (value: T) => void] {
  const { settings, updateSetting } = useSettingsContext();

  // Capture default value on first render to avoid object identity issues.
  const defaultRef = useRef(defaultValue);

  const value = key in settings ? (settings[key] as T) : defaultRef.current;

  const setValue = useCallback(
    (value: T) => {
      updateSetting(key, value);
    },
    [key, updateSetting],
  );

  return [value, setValue];
}
