export type { NpcDefinition } from './npc-definitions';
export { getNpcDefinition } from './npc-definitions';

import { NpcId } from './npc-id';

export { NpcId };

const MAIDEN_ENTRY_IDS = [
  NpcId.MAIDEN_ENTRY,
  NpcId.MAIDEN_ENTRY_10815,
  NpcId.MAIDEN_ENTRY_10816,
  NpcId.MAIDEN_ENTRY_10817,
  NpcId.MAIDEN_ENTRY_10818,
  NpcId.MAIDEN_ENTRY_10819,
];

const MAIDEN_REGULAR_IDS = [
  NpcId.MAIDEN_REGULAR,
  NpcId.MAIDEN_REGULAR_8361,
  NpcId.MAIDEN_REGULAR_8362,
  NpcId.MAIDEN_REGULAR_8363,
  NpcId.MAIDEN_REGULAR_8364,
  NpcId.MAIDEN_REGULAR_8365,
];

const MAIDEN_HARD_IDS = [
  NpcId.MAIDEN_HARD,
  NpcId.MAIDEN_HARD_10823,
  NpcId.MAIDEN_HARD_10824,
  NpcId.MAIDEN_HARD_10825,
  NpcId.MAIDEN_HARD_10826,
  NpcId.MAIDEN_HARD_10827,
];

export function isMaidenEntryNpcId(npcId: number) {
  return MAIDEN_ENTRY_IDS.includes(npcId);
}

export function isMaidenRegularNpcId(npcId: number) {
  return MAIDEN_REGULAR_IDS.includes(npcId);
}

export function isMaidenHardNpcId(npcId: number) {
  return MAIDEN_HARD_IDS.includes(npcId);
}

export function isMaidenNpcId(npcId: number): boolean {
  return (
    isMaidenEntryNpcId(npcId) ||
    isMaidenRegularNpcId(npcId) ||
    isMaidenHardNpcId(npcId)
  );
}
