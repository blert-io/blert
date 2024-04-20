'use client';

import {
  Dispatch,
  SetStateAction,
  createContext,
  useEffect,
  useState,
} from 'react';

export const enum DisplayType {
  FULL,
  COMPACT,
}

export class Display {
  private type: DisplayType;

  // If this is changed, also update `mixins.scss`.
  public static COMPACT_THRESHOLD = 940;

  public static FULL = new Display(DisplayType.FULL);
  public static COMPACT = new Display(DisplayType.COMPACT);

  constructor(type: DisplayType) {
    this.type = type;
  }

  public static fromViewportWidth(width: number): Display {
    return width < Display.COMPACT_THRESHOLD ? Display.COMPACT : Display.FULL;
  }

  public isCompact() {
    return this.type === DisplayType.COMPACT;
  }

  public isFull() {
    return this.type === DisplayType.FULL;
  }
}

export const DisplayContext = createContext<Display>(Display.FULL);

type NavbarContextType = {
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
};

export const NavbarContext = createContext<NavbarContextType>({
  sidebarOpen: false,
  setSidebarOpen: () => {},
});

export function DisplayWrapper({ children }: { children: React.ReactNode }) {
  const [display, setDisplay] = useState<Display>(Display.FULL);
  const [sidebarOpen, setSidebarOpen] = useState(display.isFull());

  useEffect(() => {
    // Set the initial display type based on the viewport width.
    setDisplay(Display.fromViewportWidth(window.innerWidth));

    const handleResize = () => {
      setDisplay(Display.fromViewportWidth(window.innerWidth));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <DisplayContext.Provider value={display}>
      <NavbarContext.Provider value={{ sidebarOpen, setSidebarOpen }}>
        {children}
      </NavbarContext.Provider>
    </DisplayContext.Provider>
  );
}
