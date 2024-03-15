'use client';

import { createContext, useEffect, useState } from 'react';

export const enum DisplayType {
  FULL,
  COMPACT,
}

export class Display {
  private type: DisplayType;

  // If this is changed, also update `mixins.scss`.
  private static COMPACT_THRESHOLD = 940;

  private static FULL = new Display(DisplayType.FULL);
  private static COMPACT = new Display(DisplayType.COMPACT);

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

export const DisplayContext = createContext<Display>(
  new Display(DisplayType.FULL),
);

export function DisplayWrapper({ children }: { children: React.ReactNode }) {
  const [display, setDisplay] = useState<Display>(
    Display.fromViewportWidth(window.innerWidth),
  );

  useEffect(() => {
    const handleResize = () => {
      setDisplay(Display.fromViewportWidth(window.innerWidth));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <DisplayContext.Provider value={display}>
      {children}
    </DisplayContext.Provider>
  );
}
