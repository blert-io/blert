import { createContext } from 'react';

export type BlertMemes = {
  inventoryTags: boolean;
  capsLock: boolean;
};

export const MemeContext = createContext<BlertMemes>({
  inventoryTags: false,
  capsLock: false,
});
