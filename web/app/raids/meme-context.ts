import { createContext } from 'react';

export type BlertMemes = {
  inventoryTags: boolean;
};

export const MemeContext = createContext<BlertMemes>({ inventoryTags: false });
