'use client';

import { useSession } from 'next-auth/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { setUserSetting, syncSettings, UserSettings } from '@/actions/settings';

import { useToast } from './toast';

export const SETTINGS_KEY_PREFIX = 'blert-setting:';

type SettingsContextValue = {
  settings: UserSettings;
  isLoading: boolean;
  updateSetting: <T>(key: string, value: T) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * Retrieves all settings from localStorage.
 */
function getLocalStorageSettings(): UserSettings {
  if (typeof window === 'undefined') {
    return {};
  }

  const settings = Object.create(null) as UserSettings;
  for (let i = 0; i < localStorage.length; i++) {
    const fullKey = localStorage.key(i);
    if (fullKey?.startsWith(SETTINGS_KEY_PREFIX)) {
      const key = fullKey.slice(SETTINGS_KEY_PREFIX.length);
      try {
        const value = localStorage.getItem(fullKey);
        if (value !== null) {
          settings[key] = JSON.parse(value);
        }
      } catch {
        // Ignore parse errors.
      }
    }
  }
  return settings;
}

/**
 * Saves a setting to localStorage.
 */
function setLocalStorageSetting(key: string, value: unknown): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(SETTINGS_KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    // Ignore localStorage errors (e.g., quota exceeded, private browsing).
  }
}

export default function SettingsProvider({
  children,
}: {
  children?: React.ReactNode;
}) {
  const session = useSession();
  const showToast = useToast();

  const [settings, setSettings] = useState<UserSettings>({});
  const [isLoading, setIsLoading] = useState(true);

  // Track if we've already synced for this session to avoid repeated syncs.
  const hasSynced = useRef(false);

  // Track updates made while sync is in progress to avoid race conditions.
  const isSyncing = useRef(false);
  const pendingUpdates = useRef(Object.create(null) as UserSettings);

  // Fetch and sync settings when user authenticates.
  useEffect(() => {
    if (session.status === 'loading') {
      return;
    }

    const localSettings = getLocalStorageSettings();

    if (session.status === 'unauthenticated') {
      setSettings(localSettings);
      setIsLoading(false);
      hasSynced.current = false;
      return;
    }

    // User is authenticated: sync settings with server.
    if (hasSynced.current) {
      return;
    }
    hasSynced.current = true;
    isSyncing.current = true;
    pendingUpdates.current = Object.create(null) as UserSettings;

    syncSettings(localSettings)
      .then((merged) => {
        // Apply any updates made while sync was in progress.
        const pending = pendingUpdates.current;
        const finalSettings = { ...merged, ...pending };

        setSettings(finalSettings);

        for (const [key, value] of Object.entries(finalSettings)) {
          setLocalStorageSetting(key, value);
        }

        // Send pending updates to server.
        for (const [key, value] of Object.entries(pending)) {
          setUserSetting(key, value).catch((error) => {
            console.error('Failed to save pending setting:', error);
          });
        }
      })
      .catch((error) => {
        console.error('Failed to sync settings:', error);
        // Fall back to localStorage on error, including any pending updates.
        const pending = pendingUpdates.current;
        setSettings({ ...localSettings, ...pending });
      })
      .finally(() => {
        isSyncing.current = false;
        pendingUpdates.current = Object.create(null) as UserSettings;
        setIsLoading(false);
      });
  }, [session.status]);

  const updateSetting = useCallback(
    <T,>(key: string, value: T) => {
      // Optimistic update.
      setSettings((prev) => ({ ...prev, [key]: value }));
      setLocalStorageSetting(key, value);

      if (session.status === 'authenticated') {
        if (isSyncing.current) {
          // Track update to apply after sync completes.
          pendingUpdates.current[key] = value;
        } else {
          setUserSetting(key, value).catch((error) => {
            console.error('Failed to save setting:', error);
            showToast('Failed to save setting', 'error');
            // Note: We don't revert the optimistic update since localStorage
            // still has the value and it will be synced on next load.
          });
        }
      }
    },
    [session.status, showToast],
  );

  const contextValue = useMemo(
    () => ({ settings, isLoading, updateSetting }),
    [settings, isLoading, updateSetting],
  );

  return (
    <SettingsContext.Provider value={contextValue}>
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * Hook to access the settings context.
 * @returns The settings context value.
 */
export function useSettingsContext(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (context === null) {
    throw new Error(
      'useSettingsContext must be used within a SettingsProvider',
    );
  }
  return context;
}
