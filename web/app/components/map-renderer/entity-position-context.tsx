'use client';

import { Coords } from '@blert/common';
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useRef,
} from 'react';

export type EntityPositions = Map<string, Coords>;

export type EntityPositionContextType = {
  positions: EntityPositions;
  updateEntityPosition: (entityId: string, pos: Coords) => void;
};

export const EntityPositionContext = createContext<EntityPositionContextType>({
  positions: new Map(),
  updateEntityPosition: () => {},
});

export const useEntityPositions = () => {
  return useContext(EntityPositionContext);
};

type EntityPositionProviderProps = {
  children: ReactNode;
};

export function EntityPositionProvider({
  children,
}: EntityPositionProviderProps) {
  const entityPositionsRef = useRef<EntityPositions>(new Map());

  const updateEntityPosition = useCallback((entityId: string, pos: Coords) => {
    entityPositionsRef.current.set(entityId, pos);
  }, []);

  const contextValue = {
    positions: entityPositionsRef.current,
    updateEntityPosition,
  };

  return (
    <EntityPositionContext.Provider value={contextValue}>
      {children}
    </EntityPositionContext.Provider>
  );
}
