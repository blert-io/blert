import { NpcId } from './npc-id';
import {
  ChallengeMode,
  MaidenCrab,
  MaidenCrabPosition,
  MaidenCrabSpawn,
  Nylo,
  NyloSpawn,
  NyloStyle,
  RoomNpc,
  RoomNpcType,
  VerzikCrab,
  VerzikCrabSpawn,
} from '../challenge';

export type NpcDefinition = {
  fullName: string;
  shortName: string;
  canonicalId: number;
  semanticId: boolean;
  size: number;
  mode: ChallengeMode;
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
    { ...definition, mode: ChallengeMode.TOB_ENTRY },
    { ...definition, mode: ChallengeMode.TOB_REGULAR },
    { ...definition, mode: ChallengeMode.TOB_HARD },
  ];
};

const [MAIDEN_ENTRY, MAIDEN_REGULAR, MAIDEN_HARD] = defineForAllModes({
  fullName: 'The Maiden of Sugadinti',
  shortName: 'Maiden',
  canonicalId: NpcId.MAIDEN_REGULAR,
  semanticId: false,
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
  semanticId: false,
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
  semanticId: false,
  size: 1,
});

const [BLOAT_ENTRY, BLOAT_REGULAR, BLOAT_HARD] = defineForAllModes({
  fullName: 'The Pestilent Bloat',
  shortName: 'Bloat',
  canonicalId: NpcId.BLOAT_REGULAR,
  semanticId: false,
  size: 5,
});

const [
  NYLOCAS_ISCHYROS_SMALL_ENTRY,
  NYLOCAS_ISCHYROS_SMALL_REGULAR,
  NYLOCAS_ISCHYROS_SMALL_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Ischyros',
  shortName: 'Melee small',
  canonicalId: NpcId.NYLOCAS_ISCHYROS_SMALL_REGULAR,
  semanticId: false,
  size: 1,
});

const [
  NYLOCAS_ISCHYROS_BIG_ENTRY,
  NYLOCAS_ISCHYROS_BIG_REGULAR,
  NYLOCAS_ISCHYROS_BIG_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Ischyros',
  shortName: 'Melee big',
  canonicalId: NpcId.NYLOCAS_ISCHYROS_BIG_REGULAR,
  semanticId: false,
  size: 2,
});

const [
  NYLOCAS_TOXOBOLOS_SMALL_ENTRY,
  NYLOCAS_TOXOBOLOS_SMALL_REGULAR,
  NYLOCAS_TOXOBOLOS_SMALL_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Toxobolos',
  shortName: 'Range small',
  canonicalId: NpcId.NYLOCAS_TOXOBOLOS_SMALL_REGULAR,
  semanticId: false,
  size: 1,
});

const [
  NYLOCAS_TOXOBOLOS_BIG_ENTRY,
  NYLOCAS_TOXOBOLOS_BIG_REGULAR,
  NYLOCAS_TOXOBOLOS_BIG_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Toxobolos',
  shortName: 'Range big',
  canonicalId: NpcId.NYLOCAS_TOXOBOLOS_BIG_REGULAR,
  semanticId: false,
  size: 2,
});

const [
  NYLOCAS_HAGIOS_SMALL_ENTRY,
  NYLOCAS_HAGIOS_SMALL_REGULAR,
  NYLOCAS_HAGIOS_SMALL_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Hagios',
  shortName: 'Mage small',
  canonicalId: NpcId.NYLOCAS_HAGIOS_SMALL_REGULAR,
  semanticId: false,
  size: 1,
});

const [
  NYLOCAS_HAGIOS_BIG_ENTRY,
  NYLOCAS_HAGIOS_BIG_REGULAR,
  NYLOCAS_HAGIOS_BIG_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Hagios',
  shortName: 'Mage big',
  canonicalId: NpcId.NYLOCAS_HAGIOS_BIG_REGULAR,
  semanticId: false,
  size: 2,
});

const NYLOCAS_PRINKIPAS = {
  fullName: 'Nylocas Prinkipas',
  shortName: 'Nylo Prince',
  canonicalId: NpcId.NYLOCAS_PRINKIPAS_MELEE,
  semanticId: true,
  size: 3,
  mode: ChallengeMode.TOB_HARD,
};

const [
  NYLOCAS_VASILIAS_ENTRY,
  NYLOCAS_VASILIAS_REGULAR,
  NYLOCAS_VASILIAS_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Vasilias',
  shortName: 'Nylo King',
  canonicalId: NpcId.NYLOCAS_VASILIAS_MELEE_REGULAR,
  semanticId: true,
  size: 4,
});

const [SOTETSEG_ENTRY, SOTETSEG_REGULAR, SOTETSEG_HARD] = defineForAllModes({
  fullName: 'Sotetseg',
  shortName: 'Sotetseg',
  canonicalId: NpcId.SOTETSEG_REGULAR,
  semanticId: false,
  size: 5,
});

const [XARPUS_IDLE_ENTRY, XARPUS_IDLE_REGULAR, XARPUS_IDLE_HARD] =
  defineForAllModes({
    fullName: 'Xarpus',
    shortName: 'Xarpus',
    canonicalId: NpcId.XARPUS_IDLE_REGULAR,
    semanticId: false,
    size: 3,
  });

const [XARPUS_ENTRY, XARPUS_REGULAR, XARPUS_HARD] = defineForAllModes({
  fullName: 'Xarpus',
  shortName: 'Xarpus',
  canonicalId: NpcId.XARPUS_REGULAR,
  semanticId: false,
  size: 5,
});

const [VERZIK_P1_ENTRY, VERZIK_P1_REGULAR, VERZIK_P1_HARD] = defineForAllModes({
  fullName: 'Verzik Vitur',
  shortName: 'Verzik',
  canonicalId: NpcId.VERZIK_P1_REGULAR,
  semanticId: false,
  size: 5,
});

const [VERZIK_P2_ENTRY, VERZIK_P2_REGULAR, VERZIK_P2_HARD] = defineForAllModes({
  fullName: 'Verzik Vitur',
  shortName: 'Verzik',
  canonicalId: NpcId.VERZIK_P2_REGULAR,
  semanticId: false,
  size: 3,
});

const [VERZIK_P3_ENTRY, VERZIK_P3_REGULAR, VERZIK_P3_HARD] = defineForAllModes({
  fullName: 'Verzik Vitur',
  shortName: 'Verzik',
  canonicalId: NpcId.VERZIK_P3_REGULAR,
  semanticId: false,
  size: 7,
});

const VERZIK_PILLAR = {
  fullName: 'Pillar',
  shortName: 'Pillar',
  canonicalId: NpcId.VERZIK_PILLAR,
  semanticId: false,
  size: 3,
  mode: ChallengeMode.TOB_REGULAR,
};

const [
  VERZIK_NYLOCAS_ISCHYROS_ENTRY,
  VERZIK_NYLOCAS_ISCHYROS_REGULAR,
  VERZIK_NYLOCAS_ISCHYROS_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Ischyros',
  shortName: 'Melee crab',
  canonicalId: NpcId.VERZIK_NYLOCAS_ISCHYROS_REGULAR,
  semanticId: false,
  size: 2,
});

const [
  VERZIK_NYLOCAS_TOXOBOLOS_ENTRY,
  VERZIK_NYLOCAS_TOXOBOLOS_REGULAR,
  VERZIK_NYLOCAS_TOXOBOLOS_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Toxobolos',
  shortName: 'Range crab',
  canonicalId: NpcId.VERZIK_NYLOCAS_TOXOBOLOS_REGULAR,
  semanticId: false,
  size: 2,
});

const [
  VERZIK_NYLOCAS_HAGIOS_ENTRY,
  VERZIK_NYLOCAS_HAGIOS_REGULAR,
  VERZIK_NYLOCAS_HAGIOS_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Hagios',
  shortName: 'Mage crab',
  canonicalId: NpcId.VERZIK_NYLOCAS_HAGIOS_REGULAR,
  semanticId: false,
  size: 2,
});

const [
  VERZIK_ATHANATOS_ENTRY,
  VERZIK_ATHANATOS_REGULAR,
  VERZIK_ATHANATOS_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Athanatos',
  shortName: 'Purple crab',
  canonicalId: NpcId.VERZIK_ATHANATOS_REGULAR,
  semanticId: false,
  size: 3,
});

const [
  VERZIK_MATOMENOS_ENTRY,
  VERZIK_MATOMENOS_REGULAR,
  VERZIK_MATOMENOS_HARD,
] = defineForAllModes({
  fullName: 'Nylocas Matomenos',
  shortName: 'Red crab',
  canonicalId: NpcId.VERZIK_MATOMENOS_REGULAR,
  semanticId: false,
  size: 2,
});

const [VERZIK_TORNADO_ENTRY, VERZIK_TORNADO_REGULAR, VERZIK_TORNADO_HARD] =
  defineForAllModes({
    fullName: 'Tornado',
    shortName: 'Tornado',
    canonicalId: NpcId.VERZIK_TORNADO_REGULAR,
    semanticId: false,
    size: 1,
  });

const JAGUAR_WARRIOR = {
  fullName: 'Jaguar Warrior',
  shortName: 'Furry',
  canonicalId: NpcId.JAGUAR_WARRIOR,
  semanticId: false,
  size: 2,
  mode: ChallengeMode.NO_MODE,
};

const SERPENT_SHAMAN = {
  fullName: 'Serpent Shaman',
  shortName: 'Shaman',
  canonicalId: NpcId.SERPENT_SHAMAN,
  semanticId: false,
  size: 1,
  mode: ChallengeMode.NO_MODE,
};

const MINOTAUR = {
  fullName: 'Minotaur',
  shortName: 'Minotaur',
  canonicalId: NpcId.MINOTAUR,
  semanticId: false,
  size: 3,
  mode: ChallengeMode.NO_MODE,
};

const FREMENNIK_ARCHER = {
  fullName: 'Fremennik Warband Archer',
  shortName: 'Archer',
  canonicalId: NpcId.FREMENNIK_ARCHER,
  semanticId: false,
  size: 1,
  mode: ChallengeMode.NO_MODE,
};

const FREMENNIK_SEER = {
  fullName: 'Fremennik Warband Seer',
  shortName: 'Seer',
  canonicalId: NpcId.FREMENNIK_SEER,
  semanticId: false,
  size: 1,
  mode: ChallengeMode.NO_MODE,
};

const FREMENNIK_BERSERKER = {
  fullName: 'Fremennik Warband Berserker',
  shortName: 'Berserker',
  canonicalId: NpcId.FREMENNIK_BERSERKER,
  semanticId: false,
  size: 1,
  mode: ChallengeMode.NO_MODE,
};

const JAVELIN_COLOSSUS = {
  fullName: 'Javelin Colossus',
  shortName: 'Javelin',
  canonicalId: NpcId.JAVELIN_COLOSSUS,
  semanticId: false,
  size: 3,
  mode: ChallengeMode.NO_MODE,
};

const MANTICORE = {
  fullName: 'Manticore',
  shortName: 'Manticore',
  canonicalId: NpcId.MANTICORE,
  semanticId: false,
  size: 3,
  mode: ChallengeMode.NO_MODE,
};

const SHOCKWAVE_COLOSSUS = {
  fullName: 'Shockwave Colossus',
  shortName: 'Shockwave',
  canonicalId: NpcId.SHOCKWAVE_COLOSSUS,
  semanticId: false,
  size: 3,
  mode: ChallengeMode.NO_MODE,
};

const SOL_HEREDIT = {
  fullName: 'Sol Heredit',
  shortName: 'Sol Heredit',
  canonicalId: NpcId.SOL_HEREDIT,
  semanticId: false,
  size: 5,
  mode: ChallengeMode.NO_MODE,
};

const SOLARFLARE = {
  fullName: 'Solarflare',
  shortName: 'Solarflare',
  canonicalId: NpcId.SOLARFLARE,
  semanticId: false,
  size: 1,
  mode: ChallengeMode.NO_MODE,
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

  // Pestilent Bloat.
  [NpcId.BLOAT_ENTRY]: BLOAT_ENTRY,
  [NpcId.BLOAT_REGULAR]: BLOAT_REGULAR,
  [NpcId.BLOAT_HARD]: BLOAT_HARD,

  // Melee nylos.
  [NpcId.NYLOCAS_ISCHYROS_SMALL_ENTRY]: NYLOCAS_ISCHYROS_SMALL_ENTRY,
  [NpcId.NYLOCAS_ISCHYROS_SMALL_REGULAR]: NYLOCAS_ISCHYROS_SMALL_REGULAR,
  [NpcId.NYLOCAS_ISCHYROS_SMALL_HARD]: NYLOCAS_ISCHYROS_SMALL_HARD,
  [NpcId.NYLOCAS_ISCHYROS_SMALL_AGGRO_ENTRY]: NYLOCAS_ISCHYROS_SMALL_ENTRY,
  [NpcId.NYLOCAS_ISCHYROS_SMALL_AGGRO_REGULAR]: NYLOCAS_ISCHYROS_SMALL_REGULAR,
  [NpcId.NYLOCAS_ISCHYROS_SMALL_AGGRO_HARD]: NYLOCAS_ISCHYROS_SMALL_HARD,
  [NpcId.NYLOCAS_ISCHYROS_BIG_ENTRY]: NYLOCAS_ISCHYROS_BIG_ENTRY,
  [NpcId.NYLOCAS_ISCHYROS_BIG_REGULAR]: NYLOCAS_ISCHYROS_BIG_REGULAR,
  [NpcId.NYLOCAS_ISCHYROS_BIG_HARD]: NYLOCAS_ISCHYROS_BIG_HARD,
  [NpcId.NYLOCAS_ISCHYROS_BIG_AGGRO_ENTRY]: NYLOCAS_ISCHYROS_BIG_ENTRY,
  [NpcId.NYLOCAS_ISCHYROS_BIG_AGGRO_REGULAR]: NYLOCAS_ISCHYROS_BIG_REGULAR,
  [NpcId.NYLOCAS_ISCHYROS_BIG_AGGRO_HARD]: NYLOCAS_ISCHYROS_BIG_HARD,

  // Range nylos.
  [NpcId.NYLOCAS_TOXOBOLOS_SMALL_ENTRY]: NYLOCAS_TOXOBOLOS_SMALL_ENTRY,
  [NpcId.NYLOCAS_TOXOBOLOS_SMALL_REGULAR]: NYLOCAS_TOXOBOLOS_SMALL_REGULAR,
  [NpcId.NYLOCAS_TOXOBOLOS_SMALL_HARD]: NYLOCAS_TOXOBOLOS_SMALL_HARD,
  [NpcId.NYLOCAS_TOXOBOLOS_SMALL_AGGRO_ENTRY]: NYLOCAS_TOXOBOLOS_SMALL_ENTRY,
  [NpcId.NYLOCAS_TOXOBOLOS_SMALL_AGGRO_REGULAR]:
    NYLOCAS_TOXOBOLOS_SMALL_REGULAR,
  [NpcId.NYLOCAS_TOXOBOLOS_SMALL_AGGRO_HARD]: NYLOCAS_TOXOBOLOS_SMALL_HARD,
  [NpcId.NYLOCAS_TOXOBOLOS_BIG_ENTRY]: NYLOCAS_TOXOBOLOS_BIG_ENTRY,
  [NpcId.NYLOCAS_TOXOBOLOS_BIG_REGULAR]: NYLOCAS_TOXOBOLOS_BIG_REGULAR,
  [NpcId.NYLOCAS_TOXOBOLOS_BIG_HARD]: NYLOCAS_TOXOBOLOS_BIG_HARD,
  [NpcId.NYLOCAS_TOXOBOLOS_BIG_AGGRO_ENTRY]: NYLOCAS_TOXOBOLOS_BIG_ENTRY,
  [NpcId.NYLOCAS_TOXOBOLOS_BIG_AGGRO_REGULAR]: NYLOCAS_TOXOBOLOS_BIG_REGULAR,
  [NpcId.NYLOCAS_TOXOBOLOS_BIG_AGGRO_HARD]: NYLOCAS_TOXOBOLOS_BIG_HARD,

  // Mage nylos.
  [NpcId.NYLOCAS_HAGIOS_SMALL_ENTRY]: NYLOCAS_HAGIOS_SMALL_ENTRY,
  [NpcId.NYLOCAS_HAGIOS_SMALL_REGULAR]: NYLOCAS_HAGIOS_SMALL_REGULAR,
  [NpcId.NYLOCAS_HAGIOS_SMALL_HARD]: NYLOCAS_HAGIOS_SMALL_HARD,
  [NpcId.NYLOCAS_HAGIOS_SMALL_AGGRO_ENTRY]: NYLOCAS_HAGIOS_SMALL_ENTRY,
  [NpcId.NYLOCAS_HAGIOS_SMALL_AGGRO_REGULAR]: NYLOCAS_HAGIOS_SMALL_REGULAR,
  [NpcId.NYLOCAS_HAGIOS_SMALL_AGGRO_HARD]: NYLOCAS_HAGIOS_SMALL_HARD,
  [NpcId.NYLOCAS_HAGIOS_BIG_ENTRY]: NYLOCAS_HAGIOS_BIG_ENTRY,
  [NpcId.NYLOCAS_HAGIOS_BIG_REGULAR]: NYLOCAS_HAGIOS_BIG_REGULAR,
  [NpcId.NYLOCAS_HAGIOS_BIG_HARD]: NYLOCAS_HAGIOS_BIG_HARD,
  [NpcId.NYLOCAS_HAGIOS_BIG_AGGRO_ENTRY]: NYLOCAS_HAGIOS_BIG_ENTRY,
  [NpcId.NYLOCAS_HAGIOS_BIG_AGGRO_REGULAR]: NYLOCAS_HAGIOS_BIG_REGULAR,
  [NpcId.NYLOCAS_HAGIOS_BIG_AGGRO_HARD]: NYLOCAS_HAGIOS_BIG_HARD,

  // HMT nylo prince.
  [NpcId.NYLOCAS_PRINKIPAS_DROPPING]: NYLOCAS_PRINKIPAS,
  [NpcId.NYLOCAS_PRINKIPAS_MELEE]: NYLOCAS_PRINKIPAS,
  [NpcId.NYLOCAS_PRINKIPAS_RANGE]: NYLOCAS_PRINKIPAS,
  [NpcId.NYLOCAS_PRINKIPAS_MAGE]: NYLOCAS_PRINKIPAS,

  // Nylo king.
  [NpcId.NYLOCAS_VASILIAS_DROPPING_ENTRY]: NYLOCAS_VASILIAS_ENTRY,
  [NpcId.NYLOCAS_VASILIAS_MELEE_ENTRY]: NYLOCAS_VASILIAS_ENTRY,
  [NpcId.NYLOCAS_VASILIAS_RANGE_ENTRY]: NYLOCAS_VASILIAS_ENTRY,
  [NpcId.NYLOCAS_VASILIAS_MAGE_ENTRY]: NYLOCAS_VASILIAS_ENTRY,
  [NpcId.NYLOCAS_VASILIAS_DROPPING_REGULAR]: NYLOCAS_VASILIAS_REGULAR,
  [NpcId.NYLOCAS_VASILIAS_MELEE_REGULAR]: NYLOCAS_VASILIAS_REGULAR,
  [NpcId.NYLOCAS_VASILIAS_RANGE_REGULAR]: NYLOCAS_VASILIAS_REGULAR,
  [NpcId.NYLOCAS_VASILIAS_MAGE_REGULAR]: NYLOCAS_VASILIAS_REGULAR,
  [NpcId.NYLOCAS_VASILIAS_DROPPING_HARD]: NYLOCAS_VASILIAS_HARD,
  [NpcId.NYLOCAS_VASILIAS_MELEE_HARD]: NYLOCAS_VASILIAS_HARD,
  [NpcId.NYLOCAS_VASILIAS_RANGE_HARD]: NYLOCAS_VASILIAS_HARD,
  [NpcId.NYLOCAS_VASILIAS_MAGE_HARD]: NYLOCAS_VASILIAS_HARD,

  // Sotetseg.
  [NpcId.SOTETSEG_IDLE_ENTRY]: SOTETSEG_ENTRY,
  [NpcId.SOTETSEG_ENTRY]: SOTETSEG_ENTRY,
  [NpcId.SOTETSEG_IDLE_REGULAR]: SOTETSEG_REGULAR,
  [NpcId.SOTETSEG_REGULAR]: SOTETSEG_REGULAR,
  [NpcId.SOTETSEG_IDLE_HARD]: SOTETSEG_HARD,
  [NpcId.SOTETSEG_HARD]: SOTETSEG_HARD,

  // Xarpus.
  [NpcId.XARPUS_IDLE_ENTRY]: XARPUS_IDLE_ENTRY,
  [NpcId.XARPUS_P1_ENTRY]: XARPUS_IDLE_ENTRY,
  [NpcId.XARPUS_IDLE_REGULAR]: XARPUS_IDLE_REGULAR,
  [NpcId.XARPUS_P1_REGULAR]: XARPUS_IDLE_REGULAR,
  [NpcId.XARPUS_IDLE_HARD]: XARPUS_IDLE_HARD,
  [NpcId.XARPUS_P1_HARD]: XARPUS_IDLE_HARD,
  [NpcId.XARPUS_ENTRY]: XARPUS_ENTRY,
  [NpcId.XARPUS_REGULAR]: XARPUS_REGULAR,
  [NpcId.XARPUS_HARD]: XARPUS_HARD,

  // Verzik Vitur.
  [NpcId.VERZIK_P1_ENTRY]: VERZIK_P1_ENTRY,
  [NpcId.VERZIK_P1_ENTRY_10832]: VERZIK_P1_ENTRY,
  [NpcId.VERZIK_P1_REGULAR]: VERZIK_P1_REGULAR,
  [NpcId.VERZIK_P1_REGULAR_8371]: VERZIK_P1_REGULAR,
  [NpcId.VERZIK_P1_HARD]: VERZIK_P1_HARD,
  [NpcId.VERZIK_P1_HARD_10849]: VERZIK_P1_HARD,

  [NpcId.VERZIK_P2_ENTRY]: VERZIK_P2_ENTRY,
  [NpcId.VERZIK_P2_REGULAR]: VERZIK_P2_REGULAR,
  [NpcId.VERZIK_P2_HARD]: VERZIK_P2_HARD,

  [NpcId.VERZIK_P3_ENTRY]: VERZIK_P3_ENTRY,
  [NpcId.VERZIK_P2_ENTRY_10834]: VERZIK_P3_ENTRY,
  [NpcId.VERZIK_P3_ENTRY_10836]: VERZIK_P3_ENTRY,
  [NpcId.VERZIK_P3_REGULAR]: VERZIK_P3_REGULAR,
  [NpcId.VERZIK_P2_REGULAR_8373]: VERZIK_P3_REGULAR,
  [NpcId.VERZIK_P3_REGULAR_8375]: VERZIK_P3_REGULAR,
  [NpcId.VERZIK_P3_HARD]: VERZIK_P3_HARD,
  [NpcId.VERZIK_P2_HARD_10851]: VERZIK_P3_HARD,
  [NpcId.VERZIK_P3_HARD_10853]: VERZIK_P3_HARD,

  [NpcId.VERZIK_PILLAR]: VERZIK_PILLAR,

  // Nylos at Verzik.
  [NpcId.VERZIK_NYLOCAS_ISCHYROS_ENTRY]: VERZIK_NYLOCAS_ISCHYROS_ENTRY,
  [NpcId.VERZIK_NYLOCAS_ISCHYROS_REGULAR]: VERZIK_NYLOCAS_ISCHYROS_REGULAR,
  [NpcId.VERZIK_NYLOCAS_ISCHYROS_HARD]: VERZIK_NYLOCAS_ISCHYROS_HARD,
  [NpcId.VERZIK_NYLOCAS_TOXOBOLOS_ENTRY]: VERZIK_NYLOCAS_TOXOBOLOS_ENTRY,
  [NpcId.VERZIK_NYLOCAS_TOXOBOLOS_REGULAR]: VERZIK_NYLOCAS_TOXOBOLOS_REGULAR,
  [NpcId.VERZIK_NYLOCAS_TOXOBOLOS_HARD]: VERZIK_NYLOCAS_TOXOBOLOS_HARD,
  [NpcId.VERZIK_NYLOCAS_HAGIOS_ENTRY]: VERZIK_NYLOCAS_HAGIOS_ENTRY,
  [NpcId.VERZIK_NYLOCAS_HAGIOS_REGULAR]: VERZIK_NYLOCAS_HAGIOS_REGULAR,
  [NpcId.VERZIK_NYLOCAS_HAGIOS_HARD]: VERZIK_NYLOCAS_HAGIOS_HARD,

  // Purple crab at Verzik.
  [NpcId.VERZIK_ATHANATOS_ENTRY]: VERZIK_ATHANATOS_ENTRY,
  [NpcId.VERZIK_ATHANATOS_REGULAR]: VERZIK_ATHANATOS_REGULAR,
  [NpcId.VERZIK_ATHANATOS_HARD]: VERZIK_ATHANATOS_HARD,

  // Red crabs at Verzik.
  [NpcId.VERZIK_MATOMENOS_ENTRY]: VERZIK_MATOMENOS_ENTRY,
  [NpcId.VERZIK_MATOMENOS_REGULAR]: VERZIK_MATOMENOS_REGULAR,
  [NpcId.VERZIK_MATOMENOS_HARD]: VERZIK_MATOMENOS_HARD,

  // Tornadoes at Verzik.
  [NpcId.VERZIK_TORNADO_ENTRY]: VERZIK_TORNADO_ENTRY,
  [NpcId.VERZIK_TORNADO_REGULAR]: VERZIK_TORNADO_REGULAR,
  [NpcId.VERZIK_TORNADO_HARD]: VERZIK_TORNADO_HARD,

  // Colosseum NPCs.
  [NpcId.JAGUAR_WARRIOR]: JAGUAR_WARRIOR,
  [NpcId.SERPENT_SHAMAN]: SERPENT_SHAMAN,
  [NpcId.MINOTAUR]: MINOTAUR,
  [NpcId.FREMENNIK_ARCHER]: FREMENNIK_ARCHER,
  [NpcId.FREMENNIK_SEER]: FREMENNIK_SEER,
  [NpcId.FREMENNIK_BERSERKER]: FREMENNIK_BERSERKER,
  [NpcId.JAVELIN_COLOSSUS]: JAVELIN_COLOSSUS,
  [NpcId.MANTICORE]: MANTICORE,
  [NpcId.SHOCKWAVE_COLOSSUS]: SHOCKWAVE_COLOSSUS,
  [NpcId.SOL_HEREDIT]: SOL_HEREDIT,
  [NpcId.SOLARFLARE]: SOLARFLARE,
};

export function getNpcDefinition(npcId: number): NpcDefinition | null {
  return NPC_DEFINITIONS[npcId] ?? null;
}

function maidenCrabSpawnString(spawn: MaidenCrabSpawn) {
  switch (spawn) {
    case MaidenCrabSpawn.SEVENTIES:
      return '70s';
    case MaidenCrabSpawn.FIFTIES:
      return '50s';
    case MaidenCrabSpawn.THIRTIES:
      return '30s';
  }
}

function maidenCrabPositionString(position: MaidenCrabPosition) {
  switch (position) {
    case MaidenCrabPosition.S1:
      return 'S1';
    case MaidenCrabPosition.N1:
      return 'N1';
    case MaidenCrabPosition.S2:
      return 'S2';
    case MaidenCrabPosition.N2:
      return 'N2';
    case MaidenCrabPosition.S3:
      return 'S3';
    case MaidenCrabPosition.N3:
      return 'N3';
    case MaidenCrabPosition.N4_INNER:
      return 'N4 Inner';
    case MaidenCrabPosition.N4_OUTER:
      return 'N4 Outer';
    case MaidenCrabPosition.S4_INNER:
      return 'S4 Inner';
    case MaidenCrabPosition.S4_OUTER:
      return 'S4 Outer';
  }
}

function nyloStyleToString(style: NyloStyle): string {
  switch (style) {
    case NyloStyle.MELEE:
      return 'melee';
    case NyloStyle.RANGE:
      return 'range';
    case NyloStyle.MAGE:
      return 'mage';
  }
}

function nyloSpawnToString(spawn: NyloSpawn): string {
  switch (spawn) {
    case NyloSpawn.EAST:
      return 'east';
    case NyloSpawn.WEST:
      return 'west';
    case NyloSpawn.SOUTH:
      return 'south';
    case NyloSpawn.SPLIT:
      return 'split';
  }
}

function verzikSpawnToString(spawn: VerzikCrabSpawn): string {
  switch (spawn) {
    case VerzikCrabSpawn.UNKNOWN:
      return 'unknown';
    case VerzikCrabSpawn.NORTH:
      return 'north';
    case VerzikCrabSpawn.NORTHEAST:
      return 'northeast';
    case VerzikCrabSpawn.NORTHWEST:
      return 'northwest';
    case VerzikCrabSpawn.EAST:
      return 'east';
    case VerzikCrabSpawn.SOUTH:
      return 'south';
    case VerzikCrabSpawn.SOUTHEAST:
      return 'southeast';
    case VerzikCrabSpawn.SOUTHWEST:
      return 'southwest';
    case VerzikCrabSpawn.WEST:
      return 'west';
  }
}

/**
 * Returns a human-readable name for the given NPC, including metadata about
 * the NPC's type.
 *
 * @param npc The NPC to get the friendly name for.
 * @param allNpcs An optional map of all NPCs in the room, used for resolving
 *   any NPCs referenced by the given NPC.
 * @returns A friendly name for the NPC.
 */
export function npcFriendlyName(
  npc: RoomNpc,
  allNpcs?: Map<number, RoomNpc>,
): string {
  switch (npc.type) {
    case RoomNpcType.MAIDEN_CRAB:
      const maidenCrab = (npc as MaidenCrab).maidenCrab;
      const position = maidenCrabPositionString(maidenCrab.position);
      const spawn = maidenCrabSpawnString(maidenCrab.spawn);
      return `${spawn} ${position}`;

    case RoomNpcType.NYLO: {
      const nylo = (npc as Nylo).nylo;

      const style = nyloStyleToString(nylo.style);

      if (nylo.spawnType === NyloSpawn.SPLIT) {
        let name = `${nylo.wave} ${style} split`;

        if (allNpcs !== undefined) {
          const parent = allNpcs.get(nylo.parentRoomId);
          if (parent !== undefined) {
            const parentName = npcFriendlyName(parent, allNpcs);
            name += ` (from ${parentName})`;
          }
        }
        return name;
      }

      let name = `${nylo.wave} ${nyloSpawnToString(nylo.spawnType)} ${style}`;
      if (nylo.big) {
        name += ' big';
      }
      return name;
    }

    case RoomNpcType.VERZIK_CRAB:
      const verzikCrab = (npc as VerzikCrab).verzikCrab;
      return `${verzikCrab.phase} ${verzikSpawnToString(verzikCrab.spawn)} crab`;

    case RoomNpcType.BASIC:
      // No special handling.
      break;
  }

  return getNpcDefinition(npc.spawnNpcId)?.fullName ?? 'Unknown NPC';
}
