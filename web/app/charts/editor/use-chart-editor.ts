import { BlertChartFormat } from '@blert/bcf';
import { useCallback, useReducer } from 'react';

import {
  EditorAction,
  EditorState,
  initialState,
  reduce,
} from './editor-state';

export type ChartEditor = {
  state: EditorState;
  dispatch: (action: EditorAction) => void;
  update: (
    mutate: (bcf: BlertChartFormat) => BlertChartFormat,
    coalesce?: string,
  ) => void;
};

export function useChartEditor(bcf: BlertChartFormat): ChartEditor {
  const [state, dispatch] = useReducer(reduce, bcf, initialState);

  const update = useCallback(
    (mutate: (bcf: BlertChartFormat) => BlertChartFormat, coalesce?: string) =>
      dispatch({ type: 'update', mutate, coalesce, at: Date.now() }),
    [],
  );

  return { state, dispatch, update };
}
