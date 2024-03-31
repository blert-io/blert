import { TobRaid } from '@blert/common';
import { Dispatch, SetStateAction, createContext } from 'react';

export const RaidContext = createContext<TobRaid | null>(null);

export type RoomActorState = {
  selectedPlayer: string | null;
  setSelectedPlayer: Dispatch<SetStateAction<string | null>>;
  selectedRoomNpc: number | null;
  setSelectedRoomNpc: Dispatch<SetStateAction<number | null>>;
};

export const ActorContext = createContext<RoomActorState>({
  selectedPlayer: null,
  setSelectedPlayer: (player) => {},
  selectedRoomNpc: null,
  setSelectedRoomNpc: (npcId) => {},
});
