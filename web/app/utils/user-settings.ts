'use client';

import { useEffect, useState } from 'react';

type UseSettingOptions<T> = {
  key: string;
  defaultValue: T;
};

/**
 * Hook for persisting user settings.
 *
 * @param key The settings key.
 * @param defaultValue The default value.
 * @returns A tuple of the current value and a `setState`-compatible function to
 *   update the value.
 */
export function useSetting<T>({
  key,
  defaultValue,
}: UseSettingOptions<T>): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return defaultValue;
    }
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore localStorage errors (e.g., quota exceeded, private browsing).
    }
  }, [key, value]);

  return [value, setValue];
}
