'use client';

import {
  Attack,
  DataSource,
  Npc,
  NpcAttack,
  PlayerAttack,
  Skill,
  SkillLevel,
  getNpcDefinition,
  npcFriendlyName,
} from '@blert/common';
import Image from 'next/image';
import {
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import Tooltip from '@/components/tooltip';
import HorizontalScrollable from '@/components/horizontal-scrollable';
import Item from '@/components/item';
import { BlertMemes, MemeContext } from '@/raids/meme-context';
import { ActorContext, RoomActorState } from '@/raids/tob/context';
import {
  PlayerState,
  PlayerStateMap,
  RoomNpcMap,
} from '@/utils/boss-room-state';
import { BoostType, maxBoostedLevel } from '@/utils/combat';

import styles from './style.module.scss';
import PlayerSkill from '../player-skill';
import KeyPrayers from '../key-prayers';

const DEFAULT_CELL_SIZE = 45;
const COLUMN_MARGIN = 5;

function npcAttackImage(attack: NpcAttack, size: number) {
  let imageUrl = '';

  switch (attack) {
    case NpcAttack.TOB_MAIDEN_AUTO:
      imageUrl = '/maiden_auto.png';
      break;
    case NpcAttack.TOB_MAIDEN_BLOOD_THROW:
      imageUrl = '/maiden_blood_throw.png';
      break;
    case NpcAttack.TOB_BLOAT_STOMP:
      imageUrl = '/bloat_stomp.webp';
      break;
    case NpcAttack.TOB_NYLO_BOSS_MELEE:
      imageUrl = '/nylo_boss_melee.png';
      break;
    case NpcAttack.TOB_NYLO_BOSS_RANGE:
      imageUrl = '/nylo_boss_range.png';
      break;
    case NpcAttack.TOB_NYLO_BOSS_MAGE:
      imageUrl = '/nylo_boss_mage.png';
      break;
    case NpcAttack.TOB_SOTE_BALL:
      imageUrl = '/sote_ball.png';
      break;
    case NpcAttack.TOB_SOTE_MELEE:
      imageUrl = '/sote_melee.png';
      break;
    case NpcAttack.TOB_SOTE_DEATH_BALL:
      imageUrl = '/sote_death_ball.png';
      break;
    case NpcAttack.TOB_XARPUS_SPIT:
      imageUrl = '/xarpus_spit.png';
      break;
    case NpcAttack.TOB_XARPUS_TURN:
      imageUrl = '/xarpus_turn.webp';
      break;
    case NpcAttack.TOB_VERZIK_P1_AUTO:
      imageUrl = '/verzik_p1_auto.png';
      break;
    case NpcAttack.TOB_VERZIK_P2_BOUNCE:
      imageUrl = '/verzik_p2_bounce.png';
      break;
    case NpcAttack.TOB_VERZIK_P2_CABBAGE:
      imageUrl = '/verzik_p2_cabbage.png';
      break;
    case NpcAttack.TOB_VERZIK_P2_PURPLE:
      imageUrl = '/verzik_p2_purple.png';
      break;
    case NpcAttack.TOB_VERZIK_P2_ZAP:
      imageUrl = '/verzik_p2_zap.png';
      break;
    case NpcAttack.TOB_VERZIK_P2_MAGE:
      imageUrl = '/verzik_p2_mage.webp';
      break;
    case NpcAttack.TOB_VERZIK_P3_WEBS:
      imageUrl = '/verzik_p3_webs.webp';
      break;
    case NpcAttack.TOB_VERZIK_P3_MELEE:
      imageUrl = '/verzik_p3_melee.webp';
      break;
    case NpcAttack.TOB_VERZIK_P3_RANGE:
      imageUrl = '/verzik_p3_range.webp';
      break;
    case NpcAttack.TOB_VERZIK_P3_MAGE:
      imageUrl = '/verzik_p3_mage.webp';
      break;
    case NpcAttack.TOB_VERZIK_P3_YELLOWS:
      imageUrl = '/verzik_p3_yellow.webp';
      break;
    case NpcAttack.TOB_VERZIK_P3_BALL:
      imageUrl = '/verzik_p3_ball.webp';
      break;

    case NpcAttack.COLOSSEUM_BERSERKER_AUTO:
      imageUrl = '/images/colosseum/fremennik-berserker.webp';
      break;
    case NpcAttack.COLOSSEUM_SEER_AUTO:
      imageUrl = '/images/colosseum/fremennik-seer.webp';
      break;
    case NpcAttack.COLOSSEUM_ARCHER_AUTO:
      imageUrl = '/images/colosseum/fremennik-archer.webp';
      break;
    case NpcAttack.COLOSSEUM_SHAMAN_AUTO:
      imageUrl = '/images/colosseum/shaman-auto.webp';
      break;
    case NpcAttack.COLOSSEUM_JAGUAR_AUTO:
      imageUrl = '/images/colosseum/jaguar-auto.webp';
      break;
    case NpcAttack.COLOSSEUM_JAVELIN_AUTO:
      imageUrl = '/images/colosseum/javelin-colossus.webp';
      break;
    case NpcAttack.COLOSSEUM_JAVELIN_TOSS:
      imageUrl = '/images/colosseum/javelin-toss.webp';
      break;
    case NpcAttack.COLOSSEUM_MANTICORE_MAGE:
      imageUrl = '/images/colosseum/manticore-mage.webp';
      break;
    case NpcAttack.COLOSSEUM_MANTICORE_RANGE:
      imageUrl = '/images/colosseum/manticore-range.webp';
      break;
    case NpcAttack.COLOSSEUM_MANTICORE_MELEE:
      imageUrl = '/images/colosseum/manticore-melee.webp';
      break;
    case NpcAttack.COLOSSEUM_SHOCKWAVE_AUTO:
      imageUrl = '/images/colosseum/shockwave-auto.webp';
      break;
    case NpcAttack.COLOSSEUM_MINOTAUR_AUTO:
      imageUrl = '/images/colosseum/minotaur-auto.webp';
      break;
    case NpcAttack.COLOSSEUM_HEREDIT_SLAM:
      imageUrl = '/images/colosseum/heredit-slam.webp';
      break;

    case NpcAttack.COLOSSEUM_HEREDIT_THRUST:
    case NpcAttack.COLOSSEUM_HEREDIT_COMBO:
    case NpcAttack.COLOSSEUM_HEREDIT_BREAK:
    default:
      imageUrl = '/images/huh.png';
      break;
  }

  return (
    <div className={styles.attackTimeline__CellImage}>
      <Image
        src={imageUrl}
        alt={`NPC attack: ${attack}`}
        height={size}
        width={size}
        style={{ objectFit: 'contain' }}
      />
    </div>
  );
}

const enum CombatStyle {
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
};

const ATTACK_METADATA: { [attack in PlayerAttack]: AttackMetadata } = {
  [PlayerAttack.ABYSSAL_BLUDGEON]: {
    tagColor: 'red',
    letter: 'BLD',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.AGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'AGS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.ATLATL_AUTO]: {
    tagColor: 'green',
    letter: 'atl',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.ATLATL_SPEC]: {
    tagColor: 'green',
    letter: 'ATL',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.BGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'BGS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.BLOWPIPE]: {
    tagColor: 'green',
    letter: 'BP',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.BLOWPIPE_SPEC]: {
    tagColor: 'green',
    letter: 'BPs',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.BOWFA]: {
    tagColor: 'green',
    letter: 'BFa',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.BURNING_CLAW_SCRATCH]: {
    tagColor: 'red',
    letter: 'bc',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.BURNING_CLAW_SPEC]: {
    tagColor: 'red',
    letter: 'BC',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.CHALLY_SPEC]: {
    tagColor: 'yellow',
    letter: 'CH',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.CHALLY_SWIPE]: {
    tagColor: 'yellow',
    letter: 'ch',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.CHIN_BLACK]: {
    tagColor: 'green',
    letter: 'CCB',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.CHIN_GREY]: {
    tagColor: 'green',
    letter: 'CCG',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.CHIN_RED]: {
    tagColor: 'green',
    letter: 'CCR',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.CLAW_SCRATCH]: {
    tagColor: 'red',
    letter: 'c',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.CLAW_SPEC]: {
    tagColor: 'red',
    letter: 'C',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.DAWN_AUTO]: {
    tagColor: 'yellow',
    letter: 'db',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.DAWN_SPEC]: {
    tagColor: 'yellow',
    letter: 'DB',
    ranged: true,
    special: true,
    style: null,
  },
  [PlayerAttack.DART]: {
    tagColor: 'green',
    letter: 'D',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.DDS_POKE]: {
    tagColor: 'yellow',
    letter: 'dds',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.DDS_SPEC]: {
    tagColor: 'yellow',
    letter: 'DDS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.DINHS_SPEC]: {
    tagColor: 'yellow',
    letter: 'BW',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.DUAL_MACUAHUITL]: {
    tagColor: 'red',
    letter: 'DMC',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.ELDER_MAUL]: {
    tagColor: 'red',
    letter: 'eld',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.ELDER_MAUL_SPEC]: {
    tagColor: 'red',
    letter: 'ELD',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.FANG_STAB]: {
    tagColor: 'red',
    letter: 'FNG',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.GOBLIN_PAINT_CANNON]: {
    tagColor: 'red',
    letter: 'GPC',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.GODSWORD_SMACK]: {
    tagColor: 'yellow',
    letter: 'gs',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.HAM_JOINT]: {
    tagColor: 'red',
    letter: 'HAM',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.HAMMER_BOP]: {
    tagColor: 'red',
    letter: 'h',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.HAMMER_SPEC]: {
    tagColor: 'red',
    letter: 'H',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.INQUISITORS_MACE]: {
    tagColor: 'red',
    letter: 'IM',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.KICK]: {
    tagColor: undefined,
    letter: 'k',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.KODAI_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.KODAI_BASH]: {
    tagColor: 'blue',
    letter: 'kb',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.NM_STAFF_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.NM_STAFF_BASH]: {
    tagColor: 'blue',
    letter: 'vnm',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.NOXIOUS_HALBERD]: {
    tagColor: 'red',
    letter: 'NH',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.PUNCH]: {
    tagColor: undefined,
    letter: 'p',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.RAPIER]: {
    tagColor: 'red',
    letter: 'R',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.SAELDOR]: {
    tagColor: 'red',
    letter: 'B',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.SANG]: {
    tagColor: 'blue',
    letter: 'T',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.SANG_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.SCEPTRE_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.SCYTHE]: {
    tagColor: 'red',
    letter: 'S',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.SCYTHE_UNCHARGED]: {
    tagColor: 'red',
    letter: 's',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.SGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'SGS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.SHADOW]: {
    tagColor: 'blue',
    letter: 'Sh',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.SHADOW_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.SOTD_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.SOULREAPER_AXE]: {
    tagColor: 'red',
    letter: 'AXE',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.STAFF_OF_LIGHT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.STAFF_OF_LIGHT_SWIPE]: {
    tagColor: 'blue',
    letter: 'SOL',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.SWIFT_BLADE]: {
    tagColor: 'red',
    letter: 'SB',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.TENT_WHIP]: {
    tagColor: 'red',
    letter: 'TW',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.TOXIC_TRIDENT]: {
    tagColor: 'blue',
    letter: 'T',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.TOXIC_TRIDENT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.TOXIC_STAFF_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.TOXIC_STAFF_SWIPE]: {
    tagColor: 'blue',
    letter: 'TS',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.TRIDENT]: {
    tagColor: 'blue',
    letter: 'T',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.TRIDENT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.TONALZTICS_AUTO]: {
    tagColor: 'yellow',
    letter: 'ga',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.TONALZTICS_SPEC]: {
    tagColor: 'yellow',
    letter: 'G',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.TONALZTICS_UNCHARGED]: {
    tagColor: 'yellow',
    letter: 'g',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.TWISTED_BOW]: {
    tagColor: 'green',
    letter: 'TB',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.VENATOR_BOW]: {
    tagColor: 'green',
    letter: 'VB',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.VOIDWAKER_AUTO]: {
    tagColor: 'yellow',
    letter: 'vw',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.VOIDWAKER_SPEC]: {
    tagColor: 'yellow',
    letter: 'VW',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.VOLATILE_NM_SPEC]: {
    tagColor: 'blue',
    letter: 'VNM',
    ranged: true,
    special: true,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.WEBWEAVER_AUTO]: {
    tagColor: 'green',
    letter: 'ww',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.WEBWEAVER_SPEC]: {
    tagColor: 'green',
    letter: 'WW',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.XGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'XGS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.ZCB_AUTO]: {
    tagColor: 'green',
    letter: 'zcb',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.ZCB_SPEC]: {
    tagColor: 'green',
    letter: 'ZCB',
    ranged: true,
    special: true,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.ZGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'ZGS',
    ranged: false,
    special: true,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.ZOMBIE_AXE]: {
    tagColor: 'red',
    letter: 'ZMB',
    ranged: false,
    special: false,
    style: CombatStyle.MELEE,
  },
  [PlayerAttack.UNKNOWN_BARRAGE]: {
    tagColor: undefined,
    letter: 'F',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.UNKNOWN_BOW]: {
    tagColor: 'green',
    letter: 'UNK',
    ranged: true,
    special: false,
    style: CombatStyle.RANGED,
  },
  [PlayerAttack.UNKNOWN_POWERED_STAFF]: {
    tagColor: 'blue',
    letter: 'UNK',
    ranged: true,
    special: false,
    style: CombatStyle.MAGIC,
  },
  [PlayerAttack.UNKNOWN]: {
    tagColor: undefined,
    letter: 'UNK',
    ranged: false,
    special: false,
    style: null,
  },
};

function makeCellImage(playerAttack: Attack, size: number, memes: BlertMemes) {
  let blunderIcon;

  switch (true) {
    case true:
      blunderIcon = (
        <Image
          className={styles.attackTimeline__CellImage__blunderIcon}
          src={'/spec.png'}
          alt="Special Attack"
          height={25}
          width={25}
        />
      );
      break;
  }

  let content;

  const meta =
    ATTACK_METADATA[playerAttack.type] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];

  if (!memes.capsLock) {
    let infoIcon = undefined;

    const trollStyles = {
      filter: 'drop-shadow(2px 4px 6px black)',
      transform: 'rotate(267deg) skewX(3.78rad)',
    };
    let troll = false;

    if (meta.special) {
      infoIcon = (
        <Image
          className={styles.attackTimeline__CellImage__InfoIcon}
          src={'/spec.png'}
          alt="Special Attack"
          height={size / 2}
          width={size / 2}
        />
      );
    }

    switch (playerAttack.type) {
      case PlayerAttack.KODAI_BARRAGE:
      case PlayerAttack.NM_STAFF_BARRAGE:
      case PlayerAttack.SANG_BARRAGE:
      case PlayerAttack.SCEPTRE_BARRAGE:
      case PlayerAttack.SHADOW_BARRAGE:
      case PlayerAttack.SOTD_BARRAGE:
      case PlayerAttack.STAFF_OF_LIGHT_BARRAGE:
      case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
      case PlayerAttack.TOXIC_STAFF_BARRAGE:
      case PlayerAttack.TRIDENT_BARRAGE:
      case PlayerAttack.UNKNOWN_BARRAGE:
        infoIcon = (
          <Image
            className={styles.attackTimeline__CellImage__InfoIcon}
            src={'/barrage.png'}
            alt="Barrage"
            height={size / 2}
            width={size / 2}
          />
        );
        break;

      case PlayerAttack.GODSWORD_SMACK:
      case PlayerAttack.HAMMER_BOP:
      case PlayerAttack.ELDER_MAUL:
        if (playerAttack.target !== undefined) {
          const npcId = playerAttack.target.id;
          if (
            !Npc.isNylocas(npcId) &&
            !Npc.isVerzikMatomenos(npcId) &&
            !Npc.isFremennikArcher(npcId)
          ) {
            troll = true;
          }
        }
        break;

      case PlayerAttack.CHALLY_SWIPE:
      case PlayerAttack.TONALZTICS_AUTO:
        if (playerAttack.target !== undefined) {
          if (!Npc.isVerzikMatomenos(playerAttack.target.id)) {
            troll = true;
          }
        }
        break;

      case PlayerAttack.KODAI_BASH:
      case PlayerAttack.NM_STAFF_BASH:
      case PlayerAttack.SCYTHE_UNCHARGED:
      case PlayerAttack.TONALZTICS_UNCHARGED:
        troll = true;
        break;
    }

    let outline = memes.inventoryTags ? meta.tagColor : undefined;

    let weaponImage;
    if (playerAttack.weapon) {
      weaponImage = (
        <Item
          name={playerAttack.weapon.name}
          quantity={1}
          outlineColor={outline}
          size={size}
          style={troll ? trollStyles : undefined}
        />
      );
    } else {
      let customImageUrl: string;
      switch (playerAttack.type) {
        case PlayerAttack.PUNCH:
          customImageUrl = '/images/combat/punch.webp';
          break;
        case PlayerAttack.KICK:
          customImageUrl = '/images/combat/kick.webp';
          break;
        default:
          customImageUrl = '/images/huh.png';
          break;
      }

      weaponImage = (
        <Image
          src={customImageUrl}
          alt="Unknown attack"
          height={size}
          width={size}
          style={{ objectFit: 'contain' }}
        />
      );
    }

    content = (
      <>
        {infoIcon}
        {weaponImage}
      </>
    );
  } else {
    // In caps lock mode, only use letters.
    content = <div className={styles.letter}>{meta.letter}</div>;
  }

  return <div className={styles.attackTimeline__CellImage}>{content}</div>;
}

const npcAttackName = (attack: NpcAttack): string => {
  // A human-readable name for the attack, to be used to complete the sentence
  // "X targeted Y with ..." or "X did ..."
  switch (attack) {
    case NpcAttack.TOB_MAIDEN_AUTO:
    case NpcAttack.TOB_VERZIK_P1_AUTO:
      return 'an auto attack';

    case NpcAttack.TOB_MAIDEN_BLOOD_THROW:
      return 'a blood throw';

    case NpcAttack.TOB_BLOAT_STOMP:
      return 'a stomp';

    case NpcAttack.TOB_NYLO_BOSS_MELEE:
    case NpcAttack.TOB_SOTE_MELEE:
    case NpcAttack.TOB_VERZIK_P3_MELEE:
      return 'a melee attack';

    case NpcAttack.TOB_NYLO_BOSS_RANGE:
    case NpcAttack.TOB_VERZIK_P2_CABBAGE:
    case NpcAttack.TOB_VERZIK_P3_RANGE:
      return 'a ranged attack';

    case NpcAttack.TOB_NYLO_BOSS_MAGE:
    case NpcAttack.TOB_VERZIK_P3_MAGE:
    case NpcAttack.TOB_VERZIK_P2_MAGE:
      return 'a magic attack';

    case NpcAttack.TOB_SOTE_BALL:
      return 'a ball';

    case NpcAttack.TOB_SOTE_DEATH_BALL:
      return 'a death ball';

    case NpcAttack.TOB_XARPUS_SPIT:
      return 'a poison spit';

    case NpcAttack.TOB_XARPUS_TURN:
      return 'a turn';

    case NpcAttack.TOB_VERZIK_P2_BOUNCE:
      return 'a bounce';

    case NpcAttack.TOB_VERZIK_P2_ZAP:
      return 'a zap';

    case NpcAttack.TOB_VERZIK_P2_PURPLE:
      return 'a purple crab';

    case NpcAttack.TOB_VERZIK_P3_AUTO:
      return 'an unknown attack';

    case NpcAttack.TOB_VERZIK_P3_WEBS:
      return 'webs';

    case NpcAttack.TOB_VERZIK_P3_YELLOWS:
      return 'yellow pools';

    case NpcAttack.TOB_VERZIK_P3_BALL:
      return 'a green ball';

    case NpcAttack.COLOSSEUM_BERSERKER_AUTO:
    case NpcAttack.COLOSSEUM_SEER_AUTO:
    case NpcAttack.COLOSSEUM_ARCHER_AUTO:
    case NpcAttack.COLOSSEUM_SHAMAN_AUTO:
    case NpcAttack.COLOSSEUM_JAGUAR_AUTO:
    case NpcAttack.COLOSSEUM_JAVELIN_AUTO:
    case NpcAttack.COLOSSEUM_SHOCKWAVE_AUTO:
    case NpcAttack.COLOSSEUM_MINOTAUR_AUTO:
      return 'an auto attack';

    case NpcAttack.COLOSSEUM_JAVELIN_TOSS:
      return 'a javelin toss';

    case NpcAttack.COLOSSEUM_MANTICORE_MAGE:
      return 'a magic attack';
    case NpcAttack.COLOSSEUM_MANTICORE_RANGE:
      return 'a ranged attack';
    case NpcAttack.COLOSSEUM_MANTICORE_MELEE:
      return 'a melee attack';

    case NpcAttack.COLOSSEUM_HEREDIT_THRUST:
      return 'a trident stab';
    case NpcAttack.COLOSSEUM_HEREDIT_SLAM:
      return 'a shield bash';
    case NpcAttack.COLOSSEUM_HEREDIT_COMBO:
      return 'a combo attack';
    case NpcAttack.COLOSSEUM_HEREDIT_BREAK:
      return 'a grapple attack';
  }

  return '';
};

const playerAttackVerb = (attack: PlayerAttack): string => {
  switch (attack) {
    case PlayerAttack.ABYSSAL_BLUDGEON:
      return 'bludgeoned';
    case PlayerAttack.AGS_SPEC:
      return "AGS'd";
    case PlayerAttack.ATLATL_AUTO:
    case PlayerAttack.ATLATL_SPEC:
      return 'atlatled';
    case PlayerAttack.BGS_SPEC:
      return "BGS'd";
    case PlayerAttack.BLOWPIPE:
    case PlayerAttack.BLOWPIPE_SPEC:
      return 'piped';
    case PlayerAttack.CHALLY_SPEC:
      return 'challied';
    case PlayerAttack.CHIN_BLACK:
    case PlayerAttack.CHIN_GREY:
    case PlayerAttack.CHIN_RED:
      return 'chinned';
    case PlayerAttack.BURNING_CLAW_SCRATCH:
    case PlayerAttack.CLAW_SCRATCH:
      return 'claw scratched';
    case PlayerAttack.BURNING_CLAW_SPEC:
    case PlayerAttack.CLAW_SPEC:
      return 'clawed';
    case PlayerAttack.DAWN_AUTO:
    case PlayerAttack.DAWN_SPEC:
      return 'dawned';
    case PlayerAttack.DART:
      return 'threw a dart at';
    case PlayerAttack.DDS_POKE:
      return 'poked';
    case PlayerAttack.DDS_SPEC:
      return 'DDSed';
    case PlayerAttack.DINHS_SPEC:
      return 'dinhsed';
    case PlayerAttack.DUAL_MACUAHUITL:
      return 'pummeled';
    case PlayerAttack.ELDER_MAUL:
    case PlayerAttack.ELDER_MAUL_SPEC:
      return 'mauled';
    case PlayerAttack.FANG_STAB:
      return 'fanged';
    case PlayerAttack.GODSWORD_SMACK:
      return 'smacked';
    case PlayerAttack.HAMMER_BOP:
      return 'hammer bopped';
    case PlayerAttack.HAMMER_SPEC:
      return 'hammered';
    case PlayerAttack.HAM_JOINT:
      return 'hammed';
    case PlayerAttack.INQUISITORS_MACE:
      return 'bashed';
    case PlayerAttack.KICK:
      return 'kicked';
    case PlayerAttack.NOXIOUS_HALBERD:
      return 'hallied';
    case PlayerAttack.PUNCH:
      return 'punched';
    case PlayerAttack.KODAI_BARRAGE:
    case PlayerAttack.NM_STAFF_BARRAGE:
    case PlayerAttack.SANG_BARRAGE:
    case PlayerAttack.SCEPTRE_BARRAGE:
    case PlayerAttack.SHADOW_BARRAGE:
    case PlayerAttack.SOTD_BARRAGE:
    case PlayerAttack.STAFF_OF_LIGHT_BARRAGE:
    case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
    case PlayerAttack.TOXIC_STAFF_BARRAGE:
    case PlayerAttack.TRIDENT_BARRAGE:
    case PlayerAttack.UNKNOWN_BARRAGE:
      return 'froze';
    case PlayerAttack.KODAI_BASH:
      return 'kodai bashed';
    case PlayerAttack.RAPIER:
      return 'stabbed';
    case PlayerAttack.SAELDOR:
    case PlayerAttack.VOIDWAKER_AUTO:
      return 'slashed';
    case PlayerAttack.SANG:
      return 'sanged';
    case PlayerAttack.SCYTHE:
    case PlayerAttack.SCYTHE_UNCHARGED:
      return 'scythed';
    case PlayerAttack.SGS_SPEC:
      return "SGS'd";
    case PlayerAttack.SHADOW:
      return 'shadowed';
    case PlayerAttack.SOULREAPER_AXE:
    case PlayerAttack.ZOMBIE_AXE:
      return 'hacked at';
    case PlayerAttack.CHALLY_SWIPE:
    case PlayerAttack.STAFF_OF_LIGHT_SWIPE:
    case PlayerAttack.TOXIC_STAFF_SWIPE:
      return 'swiped';
    case PlayerAttack.SWIFT_BLADE:
      return 'swifted';
    case PlayerAttack.TENT_WHIP:
      return 'whipped';
    case PlayerAttack.TONALZTICS_AUTO:
    case PlayerAttack.TONALZTICS_UNCHARGED:
      return 'ralos tossed';
    case PlayerAttack.TONALZTICS_SPEC:
      return 'ralosed';
    case PlayerAttack.TOXIC_TRIDENT:
    case PlayerAttack.TRIDENT:
      return 'tridented';
    case PlayerAttack.BOWFA:
    case PlayerAttack.TWISTED_BOW:
    case PlayerAttack.VENATOR_BOW:
    case PlayerAttack.WEBWEAVER_AUTO:
    case PlayerAttack.UNKNOWN_BOW:
      return 'bowed';
    case PlayerAttack.VOIDWAKER_SPEC:
      return 'voidwakered';
    case PlayerAttack.NM_STAFF_BASH:
      return 'nightmare bashed';
    case PlayerAttack.VOLATILE_NM_SPEC:
      return 'volatiled';
    case PlayerAttack.WEBWEAVER_SPEC:
      return 'webweavered';
    case PlayerAttack.XGS_SPEC:
      return "XGS'd";
    case PlayerAttack.ZCB_AUTO:
    case PlayerAttack.ZCB_SPEC:
      return "ZCB'd";
    case PlayerAttack.ZGS_SPEC:
      return "ZGS'd";
    case PlayerAttack.UNKNOWN_POWERED_STAFF:
    case PlayerAttack.UNKNOWN:
      return 'attacked';
  }

  return 'attacked';
};

type CellNpcState = {
  npcId: number;
  roomId: number;
  tick: number;
  attack: NpcAttack | null;
  target: string | null;
  label?: string;
};

type CellInfo = {
  playerState: PlayerState | null;
  npcState: CellNpcState | null;
  highlighted: boolean;
  backgroundColor?: string;
};

function buildPlayerTooltip(
  state: PlayerState,
  npcs: RoomNpcMap,
  actorContext: RoomActorState,
  tooltipUsername: string,
  imageSize: number,
  memes: BlertMemes,
) {
  const attack = state.attack!;
  const cellImage = makeCellImage(attack, imageSize, memes);

  let targetName = 'Unknown';
  let targetHp: number | undefined = undefined;
  const maybeTarget = attack.target;
  if (maybeTarget !== undefined) {
    const roomNpc = npcs.get(maybeTarget.roomId);
    if (roomNpc !== undefined) {
      targetName = npcFriendlyName(roomNpc, npcs);
      targetHp = roomNpc.stateByTick[state.tick]?.hitpoints.percentage();
    }
  }

  const tooltipId = `player-${tooltipUsername}-attack-${state.tick}`;

  const meta =
    ATTACK_METADATA[attack.type] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];
  const distance = attack.distanceToTarget;

  const combatThresholds = (boost: BoostType, level: number) => ({
    high: maxBoostedLevel(boost, level),
    low: level,
  });

  let stats = [];
  switch (meta.style) {
    case CombatStyle.MELEE:
      if (state.skills[Skill.ATTACK]) {
        stats.push(
          <PlayerSkill
            key="attack"
            skill={Skill.ATTACK}
            level={state.skills[Skill.ATTACK]}
            thresholds={combatThresholds(
              BoostType.SUPER_COMBAT,
              state.skills[Skill.ATTACK].getBase(),
            )}
          />,
        );
      }
      if (state.skills[Skill.STRENGTH]) {
        stats.push(
          <PlayerSkill
            key="strength"
            skill={Skill.STRENGTH}
            level={state.skills[Skill.STRENGTH]}
            thresholds={combatThresholds(
              BoostType.SUPER_COMBAT,
              state.skills[Skill.STRENGTH].getBase(),
            )}
          />,
        );
      }
      break;
    case CombatStyle.RANGED:
      if (state.skills[Skill.RANGED]) {
        stats.push(
          <PlayerSkill
            key="ranged"
            skill={Skill.RANGED}
            level={state.skills[Skill.RANGED]}
            thresholds={combatThresholds(
              BoostType.RANGING_POTION,
              state.skills[Skill.RANGED].getBase(),
            )}
          />,
        );
      }
      break;
    case CombatStyle.MAGIC:
      if (state.skills[Skill.MAGIC]) {
        stats.push(
          <PlayerSkill
            key="magic"
            skill={Skill.MAGIC}
            level={state.skills[Skill.MAGIC]}
            thresholds={combatThresholds(
              BoostType.SATURATED_HEART,
              state.skills[Skill.MAGIC].getBase(),
            )}
          />,
        );
      }
      break;
  }

  const tooltip = (
    <Tooltip tooltipId={tooltipId}>
      <div className={`${styles.tooltip} ${styles.playerTooltip}`}>
        <div className={styles.message}>
          <button
            className={styles.playerName}
            onClick={() => actorContext.setSelectedPlayer(state.player.name)}
          >
            {state.player.name}
          </button>
          <span>{playerAttackVerb(attack.type)}</span>
          <button className={styles.npc}>
            {targetName}
            {targetHp && !Number.isNaN(targetHp) && (
              <span className={styles.hitpoints}>
                <i className="far fa-heart" />
                {targetHp.toFixed(2)}%
              </span>
            )}
          </button>
          {meta.ranged && (
            <span>{`from ${distance} tile${distance === 1 ? '' : 's'} away`}</span>
          )}
        </div>
        {state.player.source === DataSource.PRIMARY && (
          <>
            <div className={styles.divider} />
            <div className={styles.stats}>{stats}</div>
            <KeyPrayers
              combatOnly
              prayerSet={state.player.prayerSet || 0}
              source={state.player.source}
            />
          </>
        )}
      </div>
    </Tooltip>
  );

  return { tooltipId, tooltip, cellImage };
}

const buildTickCell = (
  cellSize: number,
  cellInfo: CellInfo,
  tick: number,
  actorIndex: number,
  npcs: RoomNpcMap,
  actorContext: RoomActorState,
  memes: BlertMemes,
) => {
  const { setSelectedPlayer } = actorContext;
  let { playerState, npcState, highlighted, backgroundColor } = cellInfo;

  const imageSize = cellSize - 2;

  const style: React.CSSProperties = {
    backgroundColor,
    width: cellSize,
    height: cellSize,
  };

  if (playerState === null && npcState === null) {
    return (
      <div
        className={`${styles.cell}`}
        key={`empty-cell-${tick}-${actorIndex}`}
        style={style}
      >
        <span className={styles.attackTimeline__Nothing}></span>
      </div>
    );
  }

  let tooltip = undefined;
  let tooltipId = undefined;

  if (npcState !== null) {
    let cellImage;
    let className = styles.cell;

    if (npcState.attack !== null) {
      cellImage = npcAttackImage(npcState.attack, imageSize);
      const npcName = getNpcDefinition(npcState.npcId)?.fullName ?? 'Unknown';

      tooltipId = `npc-${npcState.roomId}-${npcState.tick}`;
      tooltip = (
        <Tooltip tooltipId={tooltipId}>
          <div className={`${styles.tooltip} ${styles.npcTooltip}`}>
            <button className={styles.npc}>{npcName}</button>
            {(npcState.target !== null && (
              <span>
                targeted
                <button onClick={() => setSelectedPlayer(npcState!.target)}>
                  {npcState.target}
                </button>
                with
              </span>
            )) || <span>did</span>}
            <span className={styles.npcAttack}>
              {npcAttackName(npcState.attack)}
            </span>
          </div>
        </Tooltip>
      );

      className += ` ${styles.npcCooldown} ${styles.cellInteractable}`;
    }

    return (
      <div
        className={className}
        key={`npc-${npcState.roomId}-${npcState.tick}`}
        data-tooltip-id={tooltipId}
        style={style}
      >
        {cellImage}
        {tooltip}
        <span className={styles.label}>{npcState.label}</span>
      </div>
    );
  }

  if (playerState !== null) {
    const username = playerState.player.name;
    const tooltipUsername = username.replace(/[^a-zA-Z0-9_-]/g, '');
    const playerIsOffCooldown =
      playerState.player.offCooldownTick <= playerState.tick;

    const diedThisTick = playerState.diedThisTick;
    const playerIsDead = playerState.isDead;

    let cellImage;

    if (playerState.attack !== undefined) {
      const attack = playerState.attack;

      const meta =
        ATTACK_METADATA[attack.type] ?? ATTACK_METADATA[PlayerAttack.UNKNOWN];

      const result = buildPlayerTooltip(
        playerState,
        npcs,
        actorContext,
        tooltipUsername,
        imageSize,
        memes,
      );
      tooltipId = result.tooltipId;
      tooltip = result.tooltip;
      cellImage = result.cellImage;

      let combatSkill: SkillLevel | undefined = undefined;
      let boostType: BoostType;

      switch (meta.style) {
        case CombatStyle.MELEE:
          combatSkill = playerState.skills[Skill.STRENGTH];
          boostType = BoostType.SUPER_COMBAT;
          break;
        case CombatStyle.RANGED:
          combatSkill = playerState.skills[Skill.RANGED];
          boostType = BoostType.RANGING_POTION;
          break;
        case CombatStyle.MAGIC:
          combatSkill = playerState.skills[Skill.MAGIC];
          boostType = BoostType.SATURATED_HEART;
          break;
        default:
          break;
      }

      if (combatSkill !== undefined) {
        if (
          combatSkill.getCurrent() ===
          maxBoostedLevel(boostType!, combatSkill.getBase())
        ) {
          style.outline = '1px solid rgba(var(--blert-green-base), 0.25)';
        } else if (combatSkill.getCurrent() > combatSkill.getBase()) {
          style.outline = '1px solid rgba(var(--blert-yellow-base), 0.5)';
        } else {
          style.outline = '1px solid rgba(var(--blert-red-base), 0.5)';
        }
      } else {
        style.outline = '1px solid rgba(var(--blert-text-color-base), 0.2)';
      }
    } else if (diedThisTick) {
      tooltipId = `player-${tooltipUsername}-death`;

      tooltip = (
        <Tooltip tooltipId={tooltipId}>
          <div className={`${styles.tooltip} ${styles.playerTooltip}`}>
            <button onClick={() => setSelectedPlayer(username)}>
              {username}
            </button>
            <span>died</span>
          </div>
        </Tooltip>
      );

      cellImage = (
        <div className={styles.attackTimeline__CellImage}>
          <Image
            src="/skull.webp"
            alt="Player died"
            height={imageSize}
            width={imageSize}
            style={{ objectFit: 'contain' }}
          />
        </div>
      );
    } else {
      cellImage = <span className={styles.attackTimeline__Nothing}></span>;
    }

    let className = styles.cell;
    if (tooltip !== undefined) {
      className += ` ${styles.cellInteractable}`;
    }
    if (playerIsOffCooldown || diedThisTick) {
      className += ` ${styles.attackTimeline__CellOffCooldown}`;
    }
    if (playerIsDead && !diedThisTick) {
      className += ` ${styles.cellDead}`;
      style.backgroundColor = undefined;
    }

    return (
      <div
        className={className}
        style={style}
        data-tooltip-id={tooltipId}
        key={`player-cell-${username}-${playerState.tick}`}
      >
        {cellImage}
        {tooltip}
      </div>
    );
  }
};

const buildTickColumn = (
  cellSize: number,
  playerState: PlayerStateMap,
  columnTick: number,
  updateTickOnPage: (tick: number) => void,
  npcs: RoomNpcMap,
  actorContext: RoomActorState,
  memes: BlertMemes,
  split?: TimelineSplit,
  backgroundColor?: string,
) => {
  const tickCells = [];
  const cellInfo: CellInfo[] = [];

  const { selectedPlayer } = actorContext;

  npcs.forEach((npc, _) => {
    if (!npc.hasAttacks) {
      return;
    }

    let npcState: CellNpcState | null = null;

    const attack = npc.stateByTick[columnTick]?.attack ?? null;
    const label = npc.stateByTick[columnTick]?.label;

    let partialNpcState = {
      npcId: npc.spawnNpcId,
      roomId: npc.roomId,
      tick: columnTick,
      label,
    };

    if (attack !== null) {
      npcState = {
        ...partialNpcState,
        attack: attack.type,
        target: attack.target,
      };
    } else if (label !== undefined) {
      npcState = {
        ...partialNpcState,
        attack: null,
        target: null,
      };
    }

    cellInfo.push({
      npcState,
      playerState: null,
      highlighted: false,
      backgroundColor,
    });
  });

  playerState.forEach((playerTimeline, playerName) => {
    const state = playerTimeline.find((event) => event?.tick === columnTick);
    cellInfo.push({
      npcState: null,
      playerState: state ?? null,
      highlighted: selectedPlayer === playerName,
      backgroundColor,
    });
  });

  for (let i = 0; i < cellInfo.length; i++) {
    tickCells.push(
      buildTickCell(
        cellSize,
        cellInfo[i],
        columnTick,
        i,
        npcs,
        actorContext,
        memes,
      ),
    );
  }

  let tooltipId = undefined;
  if (split !== undefined) {
    tooltipId = `timeline-split-${split.splitName.replaceAll(' ', '-')}-tooltip`;
  }

  const splitWidth = cellSize + 21;
  const splitTailOffset = (splitWidth - 4) / 2;

  return (
    <div
      key={`attackTimeline__${columnTick}`}
      className={styles.attackTimeline__Column}
      style={{ width: cellSize, marginRight: COLUMN_MARGIN }}
    >
      {split !== undefined && (
        <div
          className={styles.attackTimeline__RoomSplit}
          style={{ width: splitWidth }}
        >
          <Tooltip openOnClick tooltipId={tooltipId!}>
            {split.splitName}
          </Tooltip>
          <span data-tooltip-id={tooltipId}>{split.splitName}</span>
          <div className={styles.splitIndicatorWrapper}>
            <div className={styles.splitIndicatorPt1}></div>
            <div
              className={styles.splitIndicatorPt2}
              style={{ left: splitTailOffset }}
            ></div>
          </div>
        </div>
      )}
      <button
        className={styles.attackTimeline__TickHeader}
        onClick={() => updateTickOnPage(columnTick)}
        style={{ fontSize: cellSize / 2 - 1 }}
      >
        {columnTick}
      </button>
      {tickCells}
      {split !== undefined && (
        <div
          className={`${styles.attackTimeline__RoomSplit} ${styles.splitIndicatorBottom}`}
          style={{ width: splitWidth }}
        >
          <div className={styles.splitIndicatorWrapper}>
            <div className={styles.splitIndicatorPt1}></div>
          </div>
        </div>
      )}
    </div>
  );
};

type BaseTimelineProps = {
  splits: TimelineSplit[];
  backgroundColors?: TimelineColor[];
  playerState: PlayerStateMap;
  updateTickOnPage: (tick: number) => void;
  npcs: RoomNpcMap;
  actorContext: RoomActorState;
  cellSize: number;
  wrapWidth?: number;
  numRows: number;
  ticksPerRow: number;
  timelineTicks: number;
};

function BaseTimeline(props: BaseTimelineProps) {
  const {
    splits,
    backgroundColors,
    playerState,
    updateTickOnPage,
    npcs,
    actorContext,
    cellSize,
    numRows,
    ticksPerRow,
    timelineTicks,
  } = props;

  const memes = useContext(MemeContext);

  const attackTimelineColumnElements = [];

  for (let row = 0; row < numRows; row++) {
    const rowColumns = [];

    for (let i = 0; i < ticksPerRow; i++) {
      const tick = row * ticksPerRow + i + 1;
      if (tick > timelineTicks) {
        break;
      }

      const potentialSplit = splits.find((split) => split.tick === tick);

      const color = backgroundColors?.find((c) => {
        const length = c.length ?? 1;
        return tick >= c.tick && tick < c.tick + length;
      })?.backgroundColor;

      rowColumns.push(
        buildTickColumn(
          cellSize,
          playerState,
          tick,
          updateTickOnPage,
          npcs,
          actorContext,
          memes,
          potentialSplit,
          color,
        ),
      );
    }

    attackTimelineColumnElements.push(
      <div key={`row-${row}`} className={styles.row}>
        {rowColumns}
      </div>,
    );
  }

  return <>{attackTimelineColumnElements}</>;
}

export type TimelineSplit = {
  tick: number;
  splitName: string;
  unimportant?: boolean;
  splitCustomContent?: JSX.Element;
};

export type TimelineColor = {
  tick: number;
  length?: number;
  backgroundColor: string;
};

export type AttackTimelineProps = {
  currentTick: number;
  playing: boolean;
  playerState: PlayerStateMap;
  timelineTicks: number;
  splits: TimelineSplit[];
  backgroundColors?: TimelineColor[];
  updateTickOnPage: (tick: number) => void;
  npcs: RoomNpcMap;
  cellSize?: number;
  wrapWidth?: number;
};

export function AttackTimeline(props: AttackTimelineProps) {
  const {
    currentTick,
    playerState,
    updateTickOnPage,
    timelineTicks,
    backgroundColors,
    splits,
    npcs,
    cellSize = DEFAULT_CELL_SIZE,
    wrapWidth,
  } = props;

  const totalColumnWidth = cellSize + COLUMN_MARGIN;

  const actorContext = useContext(ActorContext);

  const attackTimelineRef = useRef<HTMLDivElement>(null);
  const currentTickColumnRef = useRef<HTMLDivElement>(null);

  const shouldScroll = wrapWidth === undefined;

  useEffect(() => {
    if (!shouldScroll) {
      return;
    }

    if (
      attackTimelineRef.current !== null &&
      currentTickColumnRef.current !== null
    ) {
      if (currentTick * totalColumnWidth < 525) {
        attackTimelineRef.current.scrollLeft = 0;
      } else {
        attackTimelineRef.current.scrollLeft =
          (currentTick - 1) * totalColumnWidth - 380;
      }
    }
  }, [shouldScroll, currentTick, totalColumnWidth]);

  const attackTimelineParticipants: [string, number][] = [];
  npcs.forEach((npc, roomId) => {
    if (npc.hasAttacks) {
      attackTimelineParticipants.push([
        getNpcDefinition(npc.spawnNpcId)?.shortName ?? 'Unknown',
        roomId,
      ]);
    }
  });
  const numNpcs = attackTimelineParticipants.length;
  playerState.forEach((_, playerName) => {
    attackTimelineParticipants.push([playerName, 0]);
  });

  let ticksPerRow = timelineTicks;
  let numRows = 1;

  if (wrapWidth !== undefined) {
    const timelineWidth = wrapWidth - 140;
    ticksPerRow = Math.floor(timelineWidth / (cellSize + COLUMN_MARGIN));
    numRows = Math.ceil(timelineTicks / ticksPerRow);
  }

  const legendElements: JSX.Element[] = [];

  for (let i = 0; i < attackTimelineParticipants.length; i++) {
    const [name, id] = attackTimelineParticipants[i];
    const isNpc = i < numNpcs;

    let className = styles.legendParticipant;
    let onClick;

    if (isNpc) {
      onClick = () => actorContext.setSelectedRoomNpc(id);
      className += ` ${styles.npc}`;
      if (id === actorContext.selectedRoomNpc) {
        // TODO(frolv): Support selected NPCs.
        // className += ` ${styles.selected}`;
      }
    } else {
      onClick = () =>
        actorContext.setSelectedPlayer((p) => (p === name ? null : name));
      if (name === actorContext.selectedPlayer) {
        className += ` ${styles.selected}`;
      }
    }
    legendElements.push(
      <button
        className={className}
        key={i}
        onClick={onClick}
        style={{ height: cellSize }}
      >
        {name}
      </button>,
    );
  }

  const memoizedBaseTimeline = useMemo(
    () => (
      <BaseTimeline
        splits={splits}
        backgroundColors={backgroundColors}
        playerState={playerState}
        updateTickOnPage={updateTickOnPage}
        npcs={npcs}
        actorContext={actorContext}
        cellSize={cellSize}
        numRows={numRows}
        ticksPerRow={ticksPerRow}
        timelineTicks={timelineTicks}
      />
    ),
    [
      splits,
      backgroundColors,
      playerState,
      updateTickOnPage,
      npcs,
      actorContext,
      cellSize,
      numRows,
      ticksPerRow,
      timelineTicks,
    ],
  );

  const row = Math.floor((currentTick - 1) / ticksPerRow);
  const tickOnRow = (currentTick - 1) % ticksPerRow;
  const rowHeight = legendElements.length * totalColumnWidth;
  const ACTIVE_INDICATOR_OFFSET = 67;

  const activeColumnIndicator = (
    <div
      style={{
        left: totalColumnWidth * tickOnRow + 5,
        top:
          ACTIVE_INDICATOR_OFFSET +
          row * (rowHeight + ACTIVE_INDICATOR_OFFSET + 23.5),
        height: rowHeight + 40,
        width: totalColumnWidth + 5,
      }}
      className={styles.attackTimeline__ColumnActiveIndicator}
      ref={currentTickColumnRef}
    />
  );
  const deferredColumnIndicator = useDeferredValue(activeColumnIndicator);

  return (
    <div className={styles.attackTimeline__Inner}>
      <div className={styles.attackTimeline__Legend}>
        {Array.from({ length: numRows }).map((_, i) => (
          <div className={styles.legendRow} key={i}>
            {legendElements}
          </div>
        ))}
      </div>
      <HorizontalScrollable
        className={styles.attackTimeline__Scrollable}
        customRef={attackTimelineRef}
        disable={!shouldScroll}
      >
        {deferredColumnIndicator}
        {memoizedBaseTimeline}
      </HorizontalScrollable>
    </div>
  );
}
