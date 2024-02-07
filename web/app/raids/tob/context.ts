import { Raid } from '@blert/common';
import { createContext } from 'react';

export const RaidContext = createContext<Raid | null>(null);
