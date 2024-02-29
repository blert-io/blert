import { NpcId } from './npc-id';
import { Mode } from '../raid-definitions';

export type NpcDefinition = {
  fullName: string;
  shortName: string;
  canonicalId: number;
  size: number;
  mode: Mode;
};

/**
 * Creates a copy of the given NPC definition for each raid mode.
 *
 * @param definition The NPC definition to copy.
 * @returns A tuple containing the NPC definition for each raid mode,
 *   in the order [entry, regular, hard].
 */
const defineForAllModes = (
  definition: Omit<NpcDefinition, 'mode'>,
): [NpcDefinition, NpcDefinition, NpcDefinition] => {
  return [
    { ...definition, mode: Mode.ENTRY },
    { ...definition, mode: Mode.REGULAR },
    { ...definition, mode: Mode.HARD },
  ];
};

const [MAIDEN_ENTRY, MAIDEN_REGULAR, MAIDEN_HARD] = defineForAllModes({
  fullName: 'The Maiden of Sugadinti',
  shortName: 'Maiden',
  canonicalId: NpcId.MAIDEN_REGULAR,
  size: 6,
});

const [
  MAIDEN_MATOMENOS_ENTRY,
  MAIDEN_MATOMENOS_REGULAR,
  MAIDEN_MATOMENOS_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Matomenos',
  shortName: 'Crab',
  canonicalId: NpcId.MAIDEN_MATOMENOS_REGULAR,
  size: 2,
});

const [
  MAIDEN_BLOOD_SPAWN_ENTRY,
  MAIDEN_BLOOD_SPAWN_REGULAR,
  MAIDEN_BLOOD_SPAWN_HARD,
] = defineForAllModes({
  fullName: 'Blood spawn',
  shortName: 'Blood spawn',
  canonicalId: NpcId.MAIDEN_BLOOD_SPAWN_REGULAR,
  size: 1,
});

const [BLOAT_ENTRY, BLOAT_REGULAR, BLOAT_HARD] = defineForAllModes({
  fullName: 'The Pestilent Bloat',
  shortName: 'Bloat',
  canonicalId: NpcId.BLOAT_REGULAR,
  size: 5,
});

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

  // Pestilent Bloat.
  [NpcId.BLOAT_ENTRY]: BLOAT_ENTRY,
  [NpcId.BLOAT_REGULAR]: BLOAT_REGULAR,
  [NpcId.BLOAT_HARD]: BLOAT_HARD,
};

export function getNpcDefinition(npcId: number): NpcDefinition | null {
  return NPC_DEFINITIONS[npcId] ?? null;
}
