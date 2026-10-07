import { BlertChartFormat } from '@blert/bcf';
import { useCallback, useEffect, useReducer, useState } from 'react';

import { useSettingsContext } from '@/components/settings-provider';
import { useSetting } from '@/utils/user-settings';

import {
  EditorAction,
  EditorState,
  HotbarSlots,
  initialState,
  reduce,
} from './editor-state';

export type ChartEditor = {
  state: EditorState;
  /** Whether the saved hotbar slots have replaced the initial empty ones. */
  slotsLoaded: boolean;
  dispatch: (action: EditorAction) => void;
  update: (
    mutate: (bcf: BlertChartFormat) => BlertChartFormat,
    coalesce?: string,
  ) => void;
};

export function useChartEditor(bcf: BlertChartFormat): ChartEditor {
  const [state, dispatch] = useReducer(reduce, bcf, initialState);

  const { isLoading } = useSettingsContext();
  const [savedSlots, saveSlots] = useSetting<HotbarSlots>({
    key: 'chart-editor.hotbar',
    defaultValue: state.slots,
  });
  const [slotsLoaded, setSlotsLoaded] = useState(false);

  useEffect(() => {
    if (!isLoading && !slotsLoaded) {
      dispatch({ type: 'set-slots', slots: savedSlots });
      setSlotsLoaded(true);
    }
  }, [isLoading, savedSlots, slotsLoaded]);

  useEffect(() => {
    if (slotsLoaded && state.slots !== savedSlots) {
      saveSlots(state.slots);
    }
  }, [saveSlots, savedSlots, slotsLoaded, state.slots]);

  const update = useCallback(
    (mutate: (bcf: BlertChartFormat) => BlertChartFormat, coalesce?: string) =>
      dispatch({ type: 'update', mutate, coalesce, at: Date.now() }),
    [],
  );

  return { state, slotsLoaded, dispatch, update };
}
