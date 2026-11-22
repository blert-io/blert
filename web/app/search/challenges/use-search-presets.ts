'use client';

import { useEffect, useMemo } from 'react';

import { useSetting } from '@/utils/user-settings';

import {
  DEFAULT_SELECTED_COLUMNS,
  parseSavedColumns,
  PresetColumns,
  SelectedColumn,
} from './types';

function hasNumberedColumns(columns: { column: unknown }[]): boolean {
  return columns.some(({ column }) => typeof column === 'number');
}

export function useSearchPresets() {
  const [savedActiveColumns, setActiveColumns] = useSetting<SelectedColumn[]>({
    key: 'search-active-columns',
    defaultValue: DEFAULT_SELECTED_COLUMNS,
  });

  const [savedPresets, setPresets] = useSetting<PresetColumns[]>({
    key: 'search-presets',
    defaultValue: [],
  });

  const activeColumns = useMemo(
    () => parseSavedColumns(savedActiveColumns),
    [savedActiveColumns],
  );
  const presets = useMemo(
    () =>
      savedPresets.map((preset) => ({
        ...preset,
        columns: parseSavedColumns(preset.columns),
      })),
    [savedPresets],
  );

  useEffect(() => {
    if (hasNumberedColumns(savedActiveColumns)) {
      setActiveColumns(activeColumns);
    }
    if (savedPresets.some((preset) => hasNumberedColumns(preset.columns))) {
      setPresets(presets);
    }
  }, [
    savedActiveColumns,
    savedPresets,
    activeColumns,
    presets,
    setActiveColumns,
    setPresets,
  ]);

  return { activeColumns, setActiveColumns, presets, setPresets };
}
