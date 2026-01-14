'use client';

import { useEffect, useRef } from 'react';

import { useSetting } from '@/utils/user-settings';

import {
  DEFAULT_SELECTED_COLUMNS,
  PresetColumns,
  SelectedColumn,
} from './types';

const OLD_STORAGE_KEY = 'search-column-presets';

type OldPresetStorage = {
  presets?: PresetColumns[];
  activeColumns?: SelectedColumn[];
};

function isValidSelectedColumn(value: unknown): value is SelectedColumn {
  return (
    typeof value === 'object' &&
    value !== null &&
    'column' in value &&
    typeof (value as SelectedColumn).column === 'number'
  );
}

function isValidPreset(value: unknown): value is PresetColumns {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const preset = value as PresetColumns;
  return (
    typeof preset.name === 'string' &&
    typeof preset.id === 'number' &&
    Array.isArray(preset.columns) &&
    preset.columns.every(isValidSelectedColumn)
  );
}

function isValidPresetStorage(value: unknown): value is OldPresetStorage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const storage = value as Record<string, unknown>;

  if ('activeColumns' in storage) {
    if (!Array.isArray(storage.activeColumns)) {
      return false;
    }
    if (!storage.activeColumns.every(isValidSelectedColumn)) {
      return false;
    }
  }

  if ('presets' in storage) {
    if (!Array.isArray(storage.presets)) {
      return false;
    }
    if (!storage.presets.every(isValidPreset)) {
      return false;
    }
  }

  return true;
}

function migrateOldPresets(
  setActiveColumns: (cols: SelectedColumn[]) => void,
  setPresets: (presets: PresetColumns[]) => void,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const oldData = localStorage.getItem(OLD_STORAGE_KEY);
  if (oldData === null) {
    return;
  }

  try {
    const parsed: unknown = JSON.parse(oldData);

    if (!isValidPresetStorage(parsed)) {
      console.warn('Invalid preset storage structure, skipping migration');
      localStorage.removeItem(OLD_STORAGE_KEY);
      return;
    }

    if (parsed.activeColumns !== undefined && parsed.activeColumns.length > 0) {
      setActiveColumns(parsed.activeColumns);
    }
    if (parsed.presets !== undefined && parsed.presets.length > 0) {
      setPresets(parsed.presets);
    }
    localStorage.removeItem(OLD_STORAGE_KEY);
  } catch {
    localStorage.removeItem(OLD_STORAGE_KEY);
  }
}

export function useSearchPresets() {
  const [activeColumns, setActiveColumns] = useSetting<SelectedColumn[]>({
    key: 'search-active-columns',
    defaultValue: DEFAULT_SELECTED_COLUMNS,
  });

  const [presets, setPresets] = useSetting<PresetColumns[]>({
    key: 'search-presets',
    defaultValue: [],
  });

  const hasMigrated = useRef(false);

  useEffect(() => {
    if (!hasMigrated.current) {
      hasMigrated.current = true;
      migrateOldPresets(setActiveColumns, setPresets);
    }
  }, [setActiveColumns, setPresets]);

  return { activeColumns, setActiveColumns, presets, setPresets };
}
