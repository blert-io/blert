import { NpcId } from './npc-id';
import { Mode } from '../raid-definitions';

export type NpcDefinition = {
  name: string;
  size: number;
  mode: Mode;
};

const MAIDEN_ENTRY: NpcDefinition = {
  name: 'The Maiden of Sugadinti',
  size: 6,
  mode: Mode.ENTRY,
};

const MAIDEN_REGULAR: NpcDefinition = {
  name: 'The Maiden of Sugadinti',
  size: 6,
  mode: Mode.REGULAR,
};

const MAIDEN_HARD: NpcDefinition = {
  name: 'The Maiden of Sugadinti',
  size: 6,
  mode: Mode.HARD,
};

const MAIDEN_MATOMENOS_ENTRY: NpcDefinition = {
  name: 'Nylocas Matomenos',
  size: 2,
  mode: Mode.ENTRY,
};

const MAIDEN_MATOMENOS_REGULAR: NpcDefinition = {
  name: 'Nylocas Matomenos',
  size: 2,
  mode: Mode.REGULAR,
};

const MAIDEN_MATOMENOS_HARD: NpcDefinition = {
  name: 'Nylocas Matomenos',
  size: 2,
  mode: Mode.HARD,
};

const MAIDEN_BLOOD_SPAWN_ENTRY: NpcDefinition = {
  name: 'Blood spawn',
  size: 1,
  mode: Mode.ENTRY,
};

const MAIDEN_BLOOD_SPAWN_REGULAR: NpcDefinition = {
  name: 'Blood spawn',
  size: 1,
  mode: Mode.REGULAR,
};

const MAIDEN_BLOOD_SPAWN_HARD: NpcDefinition = {
  name: 'Blood spawn',
  size: 1,
  mode: Mode.HARD,
};

const NPC_DEFINITIONS: { [id: number]: NpcDefinition } = {
  // All Maiden NPCs.
  [NpcId.MAIDEN_ENTRY]: MAIDEN_ENTRY,
  [NpcId.MAIDEN_ENTRY_10815]: MAIDEN_ENTRY,
  [NpcId.MAIDEN_ENTRY_10816]: MAIDEN_ENTRY,
  [NpcId.MAIDEN_ENTRY_10817]: MAIDEN_ENTRY,
  [NpcId.MAIDEN_ENTRY_10818]: MAIDEN_ENTRY,
  [NpcId.MAIDEN_ENTRY_10819]: MAIDEN_ENTRY,
  [NpcId.MAIDEN_REGULAR]: MAIDEN_REGULAR,
  [NpcId.MAIDEN_REGULAR_8361]: MAIDEN_REGULAR,
  [NpcId.MAIDEN_REGULAR_8362]: MAIDEN_REGULAR,
  [NpcId.MAIDEN_REGULAR_8363]: MAIDEN_REGULAR,
  [NpcId.MAIDEN_REGULAR_8364]: MAIDEN_REGULAR,
  [NpcId.MAIDEN_REGULAR_8365]: MAIDEN_REGULAR,
  [NpcId.MAIDEN_HARD]: MAIDEN_HARD,
  [NpcId.MAIDEN_HARD_10823]: MAIDEN_HARD,
  [NpcId.MAIDEN_HARD_10824]: MAIDEN_HARD,
  [NpcId.MAIDEN_HARD_10825]: MAIDEN_HARD,
  [NpcId.MAIDEN_HARD_10826]: MAIDEN_HARD,
  [NpcId.MAIDEN_HARD_10827]: MAIDEN_HARD,

  // Maiden red crabs.
  [NpcId.MAIDEN_MATOMENOS_ENTRY]: MAIDEN_MATOMENOS_ENTRY,
  [NpcId.MAIDEN_MATOMENOS_REGULAR]: MAIDEN_MATOMENOS_REGULAR,
  [NpcId.MAIDEN_MATOMENOS_HARD]: MAIDEN_MATOMENOS_HARD,

  // Maiden blood spawns.
  [NpcId.MAIDEN_BLOOD_SPAWN_ENTRY]: MAIDEN_BLOOD_SPAWN_ENTRY,
  [NpcId.MAIDEN_BLOOD_SPAWN_REGULAR]: MAIDEN_BLOOD_SPAWN_REGULAR,
  [NpcId.MAIDEN_BLOOD_SPAWN_HARD]: MAIDEN_BLOOD_SPAWN_HARD,
};

export function getNpcDefinition(npcId: number): NpcDefinition | null {
  return NPC_DEFINITIONS[npcId] ?? null;
}
