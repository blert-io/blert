import { NpcAttack, PlayerAttack } from '@blert/common';

export const enum CombatStyle {
  MELEE,
  RANGED,
  MAGIC,
}

type AttackMetadata = {
  tagColor: string | undefined;
  letter: string;
  ranged: boolean;
  special: boolean;
  style: CombatStyle | null;
  verb: string;
};

type NpcAttackDescriptionFunction = (
  npcName: React.ReactNode,
  target: React.ReactNode | null,
) => React.ReactNode;

type NpcAttackMetadata = {
  imageUrl: string;
  description: NpcAttackDescriptionFunction;
};

export const ATTACK_METADATA: Record<PlayerAttack, AttackMetadata> = {
  [PlayerAttack.ABYSSAL_BLUDGEON]: {
    tagColor: 'red',
    letter: 'BLD',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'bludgeoned',
  },
  [PlayerAttack.ACCURSED_SCEPTRE_AUTO]: {
    tagColor: 'yellow',
    letter: 'as',
    ranged: false,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'sceptred',
  },
  [PlayerAttack.ACCURSED_SCEPTRE_SPEC]: {
    tagColor: 'yellow',
    letter: 'AS',
    ranged: false,
    special: true,
    style: CombatStyle.MAGIC,
    verb: 'sceptre specced',
  },
  [PlayerAttack.AGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'AGS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: "AGS'd",
  },
  [PlayerAttack.ARCLIGHT_AUTO]: {
    tagColor: 'red',
    letter: 'arc',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'arclighted',
  },
  [PlayerAttack.ARCLIGHT_SPEC]: {
    tagColor: 'red',
    letter: 'ARC',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'arclight specced',
  },
  [PlayerAttack.ATLATL_AUTO]: {
    tagColor: 'green',
    letter: 'atl',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'atlatled',
  },
  [PlayerAttack.ATLATL_SPEC]: {
    tagColor: 'green',
    letter: 'ATL',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
    verb: 'atlatled',
  },
  [PlayerAttack.BGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'BGS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: "BGS'd",
  },
  [PlayerAttack.BLOWPIPE]: {
    tagColor: 'green',
    letter: 'BP',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'piped',
  },
  [PlayerAttack.BLOWPIPE_SPEC]: {
    tagColor: 'green',
    letter: 'BPs',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
    verb: 'pipe specced',
  },
  [PlayerAttack.BOWFA]: {
    tagColor: 'green',
    letter: 'BFa',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'bowed',
  },
  [PlayerAttack.BURNING_CLAW_SCRATCH]: {
    tagColor: 'red',
    letter: 'bc',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'claw scratched',
  },
  [PlayerAttack.BURNING_CLAW_SPEC]: {
    tagColor: 'red',
    letter: 'BC',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'clawed',
  },
  [PlayerAttack.CHALLY_SPEC]: {
    tagColor: 'yellow',
    letter: 'CH',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'challied',
  },
  [PlayerAttack.CHALLY_SWIPE]: {
    tagColor: 'yellow',
    letter: 'ch',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'swiped',
  },
  [PlayerAttack.CHIN_BLACK]: {
    tagColor: 'green',
    letter: 'CCB',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'chinned',
  },
  [PlayerAttack.CHIN_GREY]: {
    tagColor: 'green',
    letter: 'CCG',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'chinned',
  },
  [PlayerAttack.CHIN_RED]: {
    tagColor: 'green',
    letter: 'CCR',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'chinned',
  },
  [PlayerAttack.CLAW_SCRATCH]: {
    tagColor: 'red',
    letter: 'c',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'claw scratched',
  },
  [PlayerAttack.CLAW_SPEC]: {
    tagColor: 'red',
    letter: 'C',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'clawed',
  },
  [PlayerAttack.DARK_DEMONBANE]: {
    tagColor: 'blue',
    letter: 'DEM',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'demonbaned',
  },
  [PlayerAttack.DARKLIGHT_AUTO]: {
    tagColor: 'red',
    letter: 'dl',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'darklighted',
  },
  [PlayerAttack.DARKLIGHT_SPEC]: {
    tagColor: 'red',
    letter: 'DL',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'darklight specced',
  },
  [PlayerAttack.DAWN_AUTO]: {
    tagColor: 'yellow',
    letter: 'db',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'dawned',
  },
  [PlayerAttack.DAWN_SPEC]: {
    tagColor: 'yellow',
    letter: 'DB',
    ranged: true,
    special: true,
    style: null,
    verb: 'dawned',
  },
  [PlayerAttack.DART]: {
    tagColor: 'green',
    letter: 'D',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'threw a dart at',
  },
  [PlayerAttack.DDS_POKE]: {
    tagColor: 'yellow',
    letter: 'dds',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'poked',
  },
  [PlayerAttack.DDS_SPEC]: {
    tagColor: 'yellow',
    letter: 'DDS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'DDSed',
  },
  [PlayerAttack.DHAROKS_GREATAXE]: {
    tagColor: 'red',
    letter: 'DH',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'hacked',
  },
  [PlayerAttack.DINHS_SPEC]: {
    tagColor: 'yellow',
    letter: 'BW',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'dinhsed',
  },
  [PlayerAttack.DRAGON_HUNTER_LANCE]: {
    tagColor: 'red',
    letter: 'DHL',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'poked',
  },
  [PlayerAttack.DRAGON_KNIFE_AUTO]: {
    tagColor: 'green',
    letter: 'dk',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'knifed',
  },
  [PlayerAttack.DRAGON_KNIFE_SPEC]: {
    tagColor: 'green',
    letter: 'DK',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
    verb: 'knifed',
  },
  [PlayerAttack.DRAGON_SCIMITAR]: {
    tagColor: 'red',
    letter: 'DS',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'slashed',
  },
  [PlayerAttack.DUAL_MACUAHUITL]: {
    tagColor: 'red',
    letter: 'DMC',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'pummeled',
  },
  [PlayerAttack.EARTHBOUND_TECPATL]: {
    tagColor: 'red',
    letter: 'ET',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'poked',
  },
  [PlayerAttack.ELDER_MAUL]: {
    tagColor: 'red',
    letter: 'eld',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'maul whacked',
  },
  [PlayerAttack.ELDER_MAUL_SPEC]: {
    tagColor: 'red',
    letter: 'ELD',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'mauled',
  },
  [PlayerAttack.EMBERLIGHT_AUTO]: {
    tagColor: 'red',
    letter: 'em',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'embered',
  },
  [PlayerAttack.EMBERLIGHT_SPEC]: {
    tagColor: 'red',
    letter: 'EMB',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'ember specced',
  },
  [PlayerAttack.EYE_OF_AYAK_AUTO]: {
    tagColor: 'blue',
    letter: 'aya',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'ayaked',
  },
  [PlayerAttack.EYE_OF_AYAK_SPEC]: {
    tagColor: 'blue',
    letter: 'AYA',
    ranged: true,
    special: true,
    style: CombatStyle.MAGIC,
    verb: 'ayak specced',
  },
  [PlayerAttack.FANG_STAB]: {
    tagColor: 'red',
    letter: 'FNG',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'fanged',
  },
  [PlayerAttack.GLACIAL_TEMOTLI]: {
    tagColor: 'red',
    letter: 'GT',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'pummeled',
  },
  [PlayerAttack.GOBLIN_PAINT_CANNON]: {
    tagColor: 'red',
    letter: 'GPC',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'kicked',
  },
  [PlayerAttack.GODSWORD_SMACK]: {
    tagColor: 'yellow',
    letter: 'gs',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'smacked',
  },
  [PlayerAttack.GUTHANS_WARSPEAR]: {
    tagColor: 'red',
    letter: 'GW',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'attacked',
  },
  [PlayerAttack.HAM_JOINT]: {
    tagColor: 'red',
    letter: 'HAM',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'hammed',
  },
  [PlayerAttack.HAMMER_BOP]: {
    tagColor: 'red',
    letter: 'h',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'hammer bopped',
  },
  [PlayerAttack.HAMMER_SPEC]: {
    tagColor: 'red',
    letter: 'H',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'hammered',
  },
  [PlayerAttack.ICE_RUSH]: {
    tagColor: 'blue',
    letter: 'RSH',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'rushed',
  },
  [PlayerAttack.INQUISITORS_MACE]: {
    tagColor: 'red',
    letter: 'IM',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'bashed',
  },
  [PlayerAttack.KARILS_CROSSBOW]: {
    tagColor: 'green',
    letter: 'KC',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'attacked',
  },
  [PlayerAttack.KICK]: {
    tagColor: undefined,
    letter: 'k',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'kicked',
  },
  [PlayerAttack.KODAI_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.KODAI_BASH]: {
    tagColor: 'blue',
    letter: 'kb',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'kodai bashed',
  },
  [PlayerAttack.NM_STAFF_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.NM_STAFF_BASH]: {
    tagColor: 'blue',
    letter: 'vnm',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'nightmare bashed',
  },
  [PlayerAttack.NOXIOUS_HALBERD]: {
    tagColor: 'red',
    letter: 'NH',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'hallied',
  },
  [PlayerAttack.PUNCH]: {
    tagColor: undefined,
    letter: 'p',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'punched',
  },
  [PlayerAttack.RAPIER]: {
    tagColor: 'red',
    letter: 'R',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'stabbed',
  },
  [PlayerAttack.SAELDOR]: {
    tagColor: 'red',
    letter: 'B',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'slashed',
  },
  [PlayerAttack.SANG]: {
    tagColor: 'blue',
    letter: 'T',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'sanged',
  },
  [PlayerAttack.SANG_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.SCEPTRE_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.SCORCHING_BOW_AUTO]: {
    tagColor: 'green',
    letter: 'sco',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'scobowed',
  },
  [PlayerAttack.SCORCHING_BOW_SPEC]: {
    tagColor: 'green',
    letter: 'SCO',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
    verb: 'scobo specced',
  },
  [PlayerAttack.SCYTHE]: {
    tagColor: 'red',
    letter: 'S',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'scythed',
  },
  [PlayerAttack.SCYTHE_UNCHARGED]: {
    tagColor: 'red',
    letter: 's',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'scythed',
  },
  [PlayerAttack.SGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'SGS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: "SGS'd",
  },
  [PlayerAttack.SHADOW]: {
    tagColor: 'blue',
    letter: 'Sh',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'shadowed',
  },
  [PlayerAttack.SHADOW_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.SOTD_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.SOULREAPER_AXE]: {
    tagColor: 'red',
    letter: 'AXE',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'hacked at',
  },
  [PlayerAttack.STAFF_OF_LIGHT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.STAFF_OF_LIGHT_SWIPE]: {
    tagColor: 'blue',
    letter: 'SOL',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'swiped',
  },
  [PlayerAttack.SULPHUR_BLADES]: {
    tagColor: 'red',
    letter: 'SUL',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'slashed',
  },
  [PlayerAttack.SWIFT_BLADE]: {
    tagColor: 'red',
    letter: 'SB',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'swifted',
  },
  [PlayerAttack.TENT_WHIP]: {
    tagColor: 'red',
    letter: 'TW',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'whipped',
  },
  [PlayerAttack.TORAGS_HAMMERS]: {
    tagColor: 'red',
    letter: 'TH',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'attacked',
  },
  [PlayerAttack.TOXIC_TRIDENT]: {
    tagColor: 'blue',
    letter: 'T',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'tridented',
  },
  [PlayerAttack.TOXIC_TRIDENT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.TOXIC_STAFF_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.TOXIC_STAFF_SWIPE]: {
    tagColor: 'blue',
    letter: 'TS',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'swiped',
  },
  [PlayerAttack.TRIDENT]: {
    tagColor: 'blue',
    letter: 'T',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'tridented',
  },
  [PlayerAttack.TRIDENT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.TONALZTICS_AUTO]: {
    tagColor: 'yellow',
    letter: 'ga',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'ralos tossed',
  },
  [PlayerAttack.TONALZTICS_SPEC]: {
    tagColor: 'yellow',
    letter: 'G',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
    verb: 'ralosed',
  },
  [PlayerAttack.TONALZTICS_UNCHARGED]: {
    tagColor: 'yellow',
    letter: 'g',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
    verb: 'ralos tossed',
  },
  [PlayerAttack.TWISTED_BOW]: {
    tagColor: 'green',
    letter: 'TB',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'bowed',
  },
  [PlayerAttack.VENATOR_BOW]: {
    tagColor: 'green',
    letter: 'VB',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'bowed',
  },
  [PlayerAttack.VERACS_FLAIL]: {
    tagColor: 'red',
    letter: 'VF',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'attacked',
  },
  [PlayerAttack.VOIDWAKER_AUTO]: {
    tagColor: 'yellow',
    letter: 'vw',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'slashed',
  },
  [PlayerAttack.VOIDWAKER_SPEC]: {
    tagColor: 'yellow',
    letter: 'VW',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: 'voidwakered',
  },
  [PlayerAttack.VOLATILE_NM_SPEC]: {
    tagColor: 'blue',
    letter: 'VNM',
    ranged: true,
    special: true,
    style: CombatStyle.MAGIC,
    verb: 'volatiled',
  },
  [PlayerAttack.WEBWEAVER_AUTO]: {
    tagColor: 'green',
    letter: 'ww',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'bowed',
  },
  [PlayerAttack.WEBWEAVER_SPEC]: {
    tagColor: 'green',
    letter: 'WW',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
    verb: 'webweavered',
  },
  [PlayerAttack.XGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'XGS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: "XGS'd",
  },
  [PlayerAttack.ZCB_AUTO]: {
    tagColor: 'green',
    letter: 'zcb',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: "ZCB'd",
  },
  [PlayerAttack.ZCB_SPEC]: {
    tagColor: 'green',
    letter: 'ZCB',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
    verb: "ZCB'd",
  },
  [PlayerAttack.ZGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'ZGS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
    verb: "ZGS'd",
  },
  [PlayerAttack.ZOMBIE_AXE]: {
    tagColor: 'red',
    letter: 'ZMB',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
    verb: 'hacked at',
  },
  [PlayerAttack.UNKNOWN_BARRAGE]: {
    tagColor: undefined,
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'froze',
  },
  [PlayerAttack.UNKNOWN_BOW]: {
    tagColor: 'green',
    letter: 'UNK',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
    verb: 'bowed',
  },
  [PlayerAttack.UNKNOWN_POWERED_STAFF]: {
    tagColor: 'blue',
    letter: 'UNK',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
    verb: 'attacked',
  },
  [PlayerAttack.UNKNOWN]: {
    tagColor: undefined,
    letter: 'UNK',
    ranged: false,
    special: false,
    style: null,
    verb: 'attacked',
  },
};

/**
 * Standard description for attacks that don't have a specific description.
 *
 * @param attackName A human-readable name for the attack, to be used to
 * complete the sentence "X targeted Y with ..." or "X did ..."
 * @returns Function that generates a simple description of the attack.
 */
function basicDescription(attackName: string): NpcAttackDescriptionFunction {
  const description: NpcAttackDescriptionFunction = (npcName, target) => {
    if (target) {
      return (
        <span>
          {npcName} targeted {target} with {attackName}
        </span>
      );
    }
    return (
      <span>
        {npcName} did {attackName}
      </span>
    );
  };

  return description;
}

export const NPC_ATTACK_METADATA: Record<NpcAttack, NpcAttackMetadata> = {
  [NpcAttack.UNKNOWN]: {
    imageUrl: '/images/huh.png',
    description: basicDescription('an unknown attack'),
  },
  [NpcAttack.TOB_MAIDEN_AUTO]: {
    imageUrl: '/maiden_auto.png',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.TOB_MAIDEN_BLOOD_THROW]: {
    imageUrl: '/maiden_blood_throw.png',
    description: (npcName, target) => (
      <span>
        {npcName} threw blood{target ? <> at {target}</> : ''}
      </span>
    ),
  },
  [NpcAttack.TOB_BLOAT_STOMP]: {
    imageUrl: '/bloat_stomp.webp',
    description: (npcName, _) => <span>{npcName} stomped</span>,
  },
  [NpcAttack.TOB_NYLO_BOSS_MELEE]: {
    imageUrl: '/nylo_boss_melee.png',
    description: basicDescription('a melee attack'),
  },
  [NpcAttack.TOB_NYLO_BOSS_RANGE]: {
    imageUrl: '/nylo_boss_range.png',
    description: basicDescription('a ranged attack'),
  },
  [NpcAttack.TOB_NYLO_BOSS_MAGE]: {
    imageUrl: '/nylo_boss_mage.png',
    description: basicDescription('a magic attack'),
  },
  [NpcAttack.TOB_SOTE_MELEE]: {
    imageUrl: '/sote_melee.png',
    description: basicDescription('a melee attack'),
  },
  [NpcAttack.TOB_SOTE_BALL]: {
    imageUrl: '/sote_ball.png',
    description: basicDescription('a ball'),
  },
  [NpcAttack.TOB_SOTE_DEATH_BALL]: {
    imageUrl: '/sote_death_ball.png',
    description: (npcName, target) => (
      <span>
        {npcName} launched a death ball{target ? <> at {target}</> : ''}
      </span>
    ),
  },
  [NpcAttack.TOB_XARPUS_SPIT]: {
    imageUrl: '/xarpus_spit.png',
    description: (npcName, target) => (
      <span>
        {npcName} spat poison{target ? <> at {target}</> : ''}
      </span>
    ),
  },
  [NpcAttack.TOB_XARPUS_TURN]: {
    imageUrl: '/xarpus_turn.webp',
    description: (npcName, _) => <span>{npcName} turned</span>,
  },
  [NpcAttack.TOB_VERZIK_P1_AUTO]: {
    imageUrl: '/verzik_p1_auto.png',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.TOB_VERZIK_P2_BOUNCE]: {
    imageUrl: '/verzik_p2_bounce.png',
    description: (npcName, target) => (
      <span>
        {npcName} bounced {target ?? 'someone'}
      </span>
    ),
  },
  [NpcAttack.TOB_VERZIK_P2_CABBAGE]: {
    imageUrl: '/verzik_p2_cabbage.png',
    description: basicDescription('a ranged attack'),
  },
  [NpcAttack.TOB_VERZIK_P2_ZAP]: {
    imageUrl: '/verzik_p2_zap.png',
    description: basicDescription('a zap'),
  },
  [NpcAttack.TOB_VERZIK_P2_PURPLE]: {
    imageUrl: '/verzik_p2_purple.png',
    description: basicDescription('a purple crab'),
  },
  [NpcAttack.TOB_VERZIK_P2_MAGE]: {
    imageUrl: '/verzik_p2_mage.webp',
    description: basicDescription('a magic attack'),
  },
  [NpcAttack.TOB_VERZIK_P3_AUTO]: {
    imageUrl: '/images/huh.png',
    description: basicDescription('an unknown attack'),
  },
  [NpcAttack.TOB_VERZIK_P3_MELEE]: {
    imageUrl: '/verzik_p3_melee.webp',
    description: basicDescription('a melee attack'),
  },
  [NpcAttack.TOB_VERZIK_P3_RANGE]: {
    imageUrl: '/verzik_p3_range.webp',
    description: basicDescription('a ranged attack'),
  },
  [NpcAttack.TOB_VERZIK_P3_MAGE]: {
    imageUrl: '/verzik_p3_mage.webp',
    description: basicDescription('a magic attack'),
  },
  [NpcAttack.TOB_VERZIK_P3_WEBS]: {
    imageUrl: '/verzik_p3_webs.webp',
    description: (npcName, _) => <span>{npcName} started releasing webs</span>,
  },
  [NpcAttack.TOB_VERZIK_P3_YELLOWS]: {
    imageUrl: '/verzik_p3_yellow.webp',
    description: (npcName, _) => <span>{npcName} spawned yellow pools</span>,
  },
  [NpcAttack.TOB_VERZIK_P3_BALL]: {
    imageUrl: '/verzik_p3_ball.webp',
    description: (npcName, target) => (
      <span>
        {npcName} launched a green ball{target ? <> at {target}</> : ''}
      </span>
    ),
  },
  [NpcAttack.COLOSSEUM_BERSERKER_AUTO]: {
    imageUrl: '/images/colosseum/fremennik-berserker.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.COLOSSEUM_SEER_AUTO]: {
    imageUrl: '/images/colosseum/fremennik-seer.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.COLOSSEUM_ARCHER_AUTO]: {
    imageUrl: '/images/colosseum/fremennik-archer.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.COLOSSEUM_SHAMAN_AUTO]: {
    imageUrl: '/images/colosseum/shaman-auto.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.COLOSSEUM_JAGUAR_AUTO]: {
    imageUrl: '/images/colosseum/jaguar-auto.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.COLOSSEUM_JAVELIN_AUTO]: {
    imageUrl: '/images/colosseum/javelin-colossus.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.COLOSSEUM_JAVELIN_TOSS]: {
    imageUrl: '/images/colosseum/javelin-toss.webp',
    description: basicDescription('a javelin toss'),
  },
  [NpcAttack.COLOSSEUM_MANTICORE_MAGE]: {
    imageUrl: '/images/colosseum/manticore-mage.webp',
    description: basicDescription('a magic attack'),
  },
  [NpcAttack.COLOSSEUM_MANTICORE_RANGE]: {
    imageUrl: '/images/colosseum/manticore-range.webp',
    description: basicDescription('a ranged attack'),
  },
  [NpcAttack.COLOSSEUM_MANTICORE_MELEE]: {
    imageUrl: '/images/colosseum/manticore-melee.webp',
    description: basicDescription('a melee attack'),
  },
  [NpcAttack.COLOSSEUM_SHOCKWAVE_AUTO]: {
    imageUrl: '/images/colosseum/shockwave-auto.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.COLOSSEUM_MINOTAUR_AUTO]: {
    imageUrl: '/images/colosseum/minotaur-auto.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.COLOSSEUM_HEREDIT_THRUST]: {
    imageUrl: '/images/huh.png',
    description: basicDescription('a trident stab'),
  },
  [NpcAttack.COLOSSEUM_HEREDIT_SLAM]: {
    imageUrl: '/images/colosseum/heredit-slam.webp',
    description: basicDescription('a shield bash'),
  },
  [NpcAttack.COLOSSEUM_HEREDIT_COMBO]: {
    imageUrl: '/images/huh.png',
    description: basicDescription('a combo attack'),
  },
  [NpcAttack.COLOSSEUM_HEREDIT_BREAK]: {
    imageUrl: '/images/huh.png',
    description: basicDescription('a grapple attack'),
  },
  [NpcAttack.INFERNO_BAT_AUTO]: {
    imageUrl: '/images/inferno/bat-auto.png',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.INFERNO_BLOB_RANGED]: {
    imageUrl: '/images/inferno/blob-ranged.png',
    description: basicDescription('a ranged attack'),
  },
  [NpcAttack.INFERNO_BLOB_MAGE]: {
    imageUrl: '/images/inferno/blob-mage.png',
    description: basicDescription('a magic attack'),
  },
  [NpcAttack.INFERNO_BLOB_MELEE]: {
    imageUrl: '/images/combat/punch.webp',
    description: basicDescription('a melee attack'),
  },
  [NpcAttack.INFERNO_BLOBLET_RANGED_AUTO]: {
    imageUrl: '/images/npcs/7695.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.INFERNO_BLOBLET_MAGE_AUTO]: {
    imageUrl: '/images/npcs/7694.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.INFERNO_BLOBLET_MELEE_AUTO]: {
    imageUrl: '/images/npcs/7696.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.INFERNO_MELEER_AUTO]: {
    imageUrl: '/images/inferno/meleer-auto.png',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.INFERNO_MELEER_DIG]: {
    imageUrl: '/images/inferno/meleer-dig.png',
    description: (npcName, _) => <span>{npcName} dug</span>,
  },
  [NpcAttack.INFERNO_RANGER_AUTO]: {
    imageUrl: '/images/inferno/ranger-auto.png',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.INFERNO_RANGER_MELEE]: {
    imageUrl: '/images/combat/punch.webp',
    description: basicDescription('a melee attack'),
  },
  [NpcAttack.INFERNO_MAGER_AUTO]: {
    imageUrl: '/images/inferno/mager-auto.png',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.INFERNO_MAGER_MELEE]: {
    imageUrl: '/images/combat/punch.webp',
    description: basicDescription('a melee attack'),
  },
  [NpcAttack.INFERNO_MAGER_RESURRECT]: {
    imageUrl: '/images/inferno/mager-resurrect.png',
    description: (npcName, target) => (
      <span>
        {npcName} resurrected {target ?? 'someone'}
      </span>
    ),
  },
  [NpcAttack.INFERNO_JAD_RANGED]: {
    imageUrl: '/images/inferno/jad-ranged.png',
    description: basicDescription('a ranged attack'),
  },
  [NpcAttack.INFERNO_JAD_MAGE]: {
    imageUrl: '/images/inferno/jad-mage.png',
    description: basicDescription('a magic attack'),
  },
  [NpcAttack.INFERNO_JAD_MELEE]: {
    imageUrl: '/images/combat/punch.webp',
    description: basicDescription('a melee attack'),
  },
  [NpcAttack.INFERNO_JAD_HEALER_AUTO]: {
    imageUrl: '/images/npcs/7701.webp',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.INFERNO_ZUK_AUTO]: {
    imageUrl: '/images/inferno/zuk-auto.png',
    description: basicDescription('an auto attack'),
  },
  [NpcAttack.MOKHAIOTL_AUTO]: {
    imageUrl: '/images/huh.png',
    description: basicDescription('an orb'),
  },
  [NpcAttack.MOKHAIOTL_RANGED_AUTO]: {
    imageUrl: '/images/mokhaiotl/ranged-orb.png',
    description: basicDescription('a ranged orb'),
  },
  [NpcAttack.MOKHAIOTL_MAGE_AUTO]: {
    imageUrl: '/images/mokhaiotl/magic-orb.png',
    description: basicDescription('a magic orb'),
  },
  [NpcAttack.MOKHAIOTL_MELEE_AUTO]: {
    imageUrl: '/images/mokhaiotl/melee-orb.png',
    description: basicDescription('a melee orb'),
  },
  [NpcAttack.MOKHAIOTL_BALL]: {
    imageUrl: '/images/huh.png',
    description: (npcName, _) => <span>{npcName} launched a ball</span>,
  },
  [NpcAttack.MOKHAIOTL_RANGED_BALL]: {
    imageUrl: '/images/mokhaiotl/ranged-ball.png',
    description: (npcName, _) => <span>{npcName} launched a ranged ball</span>,
  },
  [NpcAttack.MOKHAIOTL_MAGE_BALL]: {
    imageUrl: '/images/mokhaiotl/magic-ball.png',
    description: (npcName, _) => <span>{npcName} launched a magic ball</span>,
  },
  [NpcAttack.MOKHAIOTL_CHARGE]: {
    imageUrl: '/images/mokhaiotl/charge.png',
    description: (npcName, _) => <span>{npcName} started charging</span>,
  },
  [NpcAttack.MOKHAIOTL_BLAST]: {
    imageUrl: '/images/mokhaiotl/blast.png',
    description: basicDescription('a blast'),
  },
  [NpcAttack.MOKHAIOTL_RACECAR]: {
    imageUrl: '/images/mokhaiotl/racecar.webp',
    description: (npcName, target) => (
      <span>
        {npcName} dug{target ? <> towards {target}</> : ''}
      </span>
    ),
  },
  [NpcAttack.MOKHAIOTL_SLAM]: {
    imageUrl: '/images/mokhaiotl/shockwave.png',
    description: (npcName, _) => <span>{npcName} slammed the ground</span>,
  },
  [NpcAttack.MOKHAIOTL_SHOCKWAVE]: {
    imageUrl: '/images/mokhaiotl/shockwave.png',
    description: (npcName, _) => <span>{npcName} released a shockwave</span>,
  },
  [NpcAttack.MOKHAIOTL_MELEE]: {
    imageUrl: '/images/mokhaiotl/melee.png',
    description: basicDescription('a melee attack'),
  },
};
