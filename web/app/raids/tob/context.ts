import { Raid } from '@blert/common';
import { createContext } from 'react';

export const RaidContext = createContext<Raid | null>(null);

type RoomActorState = {
  selectedPlayer: string | null;
  setSelectedPlayer: (player: string | null) => void;
  selectedRoomNpc: number | null;
  setSelectedRoomNpc: (npcId: number | null) => void;
};

export const ActorContext = createContext<RoomActorState>({
  selectedPlayer: null,
  setSelectedPlayer: (player) => {},
  selectedRoomNpc: null,
  setSelectedRoomNpc: (npcId) => {},
});
