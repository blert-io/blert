'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { useDisplay } from '@/display';
import { useSetting } from '@/utils/user-settings';

type FilterPanelState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  activeCount: number;
  setActiveCount: (n: number) => void;
};

const FilterPanelContext = createContext<FilterPanelState | null>(null);

export function FilterPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const display = useDisplay();
  const [desktopOpen, setDesktopOpen] = useSetting<boolean>({
    key: 'search-filter-panel-open',
    defaultValue: true,
  });
  const [compactOpen, setCompactOpen] = useState(false);
  const [activeCount, setActiveCount] = useState(0);

  const isCompact = display.isCompact();
  const open = isCompact ? compactOpen : desktopOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (isCompact) {
        setCompactOpen(next);
      } else {
        setDesktopOpen(next);
      }
    },
    [isCompact, setDesktopOpen],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  const value = useMemo(
    () => ({ open, setOpen, toggle, activeCount, setActiveCount }),
    [open, setOpen, toggle, activeCount],
  );

  return (
    <FilterPanelContext.Provider value={value}>
      {children}
    </FilterPanelContext.Provider>
  );
}

export function useFilterPanel(): FilterPanelState {
  const ctx = useContext(FilterPanelContext);
  if (ctx === null) {
    throw new Error('useFilterPanel must be used within a FilterPanelProvider');
  }
  return ctx;
}
