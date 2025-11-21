'use client';

import { createContext, useState } from 'react';

export type SetupViewingContextType = {
  highlightedItemId: number | null;
  setHighlightedItemId: (itemId: number | null) => void;
  highlightedPlayerIndex: number | null;
  setHighlightedPlayerIndex: (index: number | null) => void;
};

export const SetupViewingContext = createContext<SetupViewingContextType>({
  highlightedItemId: null,
  setHighlightedItemId: () => {
    /* noop */
  },
  highlightedPlayerIndex: null,
  setHighlightedPlayerIndex: () => {
    /* noop */
  },
});

export function SetupViewingContextProvider({
  children,
  initialHighlightedPlayer = null,
}: {
  children: React.ReactNode;
  initialHighlightedPlayer?: number | null;
}) {
  const [highlightedItemId, setHighlightedItemId] = useState<number | null>(
    null,
  );
  const [highlightedPlayerIndex, setHighlightedPlayerIndex] = useState<
    number | null
  >(initialHighlightedPlayer);

  return (
    <SetupViewingContext.Provider
      value={{
        highlightedItemId,
        setHighlightedItemId,
        highlightedPlayerIndex,
        setHighlightedPlayerIndex,
      }}
    >
      {children}
    </SetupViewingContext.Provider>
  );
}
