'use client';

import {
  Attack,
  Npc,
  NpcAttack,
  PlayerAttack,
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

import { CollapsiblePanel } from '../collapsible-panel/collapsible-panel';
import HorizontalScrollable from '../horizontal-scrollable';
import Item from '../item';
import { LigmaTooltip } from '../ligma-tooltip/ligma-tooltip';
import { BlertMemes, MemeContext } from '../../raids/meme-context';
import { ActorContext, RoomActorState } from '../../raids/tob/context';
import {
  PlayerState,
  PlayerStateMap,
  RoomNpcMap,
} from '../../utils/boss-room-state';

import styles from './styles.module.scss';

const DEFAULT_CELL_SIZE = 50;
const COLUMN_MARGIN = 5;

const npcAttackImage = (attack: NpcAttack) => {
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
      <div className={styles.npcAttackCellImage}>
        <Image
          src={imageUrl}
          alt={`NPC attack: ${attack}`}
          fill
          style={{ objectFit: 'contain' }}
        />
      </div>
    </div>
  );
};

type AttackMetadata = {
  tagColor: string | undefined;
  letter: string;
  ranged: boolean;
  special: boolean;
};

const ATTACK_METADATA: { [attack in PlayerAttack]: AttackMetadata } = {
  [PlayerAttack.BGS_SMACK]: {
    tagColor: 'yellow',
    letter: 'bg',
    ranged: false,
    special: false,
  },
  [PlayerAttack.BGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'BGS',
    ranged: false,
    special: true,
  },
  [PlayerAttack.BLOWPIPE]: {
    tagColor: 'green',
    letter: 'BP',
    ranged: true,
    special: false,
  },
  [PlayerAttack.BOWFA]: {
    tagColor: 'green',
    letter: 'BFa',
    ranged: true,
    special: false,
  },
  [PlayerAttack.CHALLY_SPEC]: {
    tagColor: 'yellow',
    letter: 'CH',
    ranged: false,
    special: true,
  },
  [PlayerAttack.CHALLY_SWIPE]: {
    tagColor: 'yellow',
    letter: 'ch',
    ranged: false,
    special: false,
  },
  [PlayerAttack.CHIN_BLACK]: {
    tagColor: 'green',
    letter: 'CCB',
    ranged: true,
    special: false,
  },
  [PlayerAttack.CHIN_GREY]: {
    tagColor: 'green',
    letter: 'CCG',
    ranged: true,
    special: false,
  },
  [PlayerAttack.CHIN_RED]: {
    tagColor: 'green',
    letter: 'CCR',
    ranged: true,
    special: false,
  },
  [PlayerAttack.CLAW_SCRATCH]: {
    tagColor: 'red',
    letter: 'c',
    ranged: false,
    special: false,
  },
  [PlayerAttack.CLAW_SPEC]: {
    tagColor: 'red',
    letter: 'C',
    ranged: false,
    special: true,
  },
  [PlayerAttack.DAWN_SPEC]: {
    tagColor: 'yellow',
    letter: 'DB',
    ranged: true,
    special: true,
  },
  [PlayerAttack.DINHS_SPEC]: {
    tagColor: 'yellow',
    letter: 'BW',
    ranged: false,
    special: true,
  },
  [PlayerAttack.FANG_STAB]: {
    tagColor: 'red',
    letter: 'FNG',
    ranged: false,
    special: false,
  },
  [PlayerAttack.HAMMER_BOP]: {
    tagColor: 'red',
    letter: 'h',
    ranged: false,
    special: false,
  },
  [PlayerAttack.HAMMER_SPEC]: {
    tagColor: 'red',
    letter: 'H',
    ranged: false,
    special: true,
  },
  [PlayerAttack.HAM_JOINT]: {
    tagColor: 'red',
    letter: 'SB',
    ranged: false,
    special: false,
  },
  [PlayerAttack.KICK]: {
    tagColor: undefined,
    letter: 'k',
    ranged: false,
    special: false,
  },
  [PlayerAttack.KODAI_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.KODAI_BASH]: {
    tagColor: 'blue',
    letter: 'kb',
    ranged: false,
    special: false,
  },
  [PlayerAttack.PUNCH]: {
    tagColor: undefined,
    letter: 'p',
    ranged: false,
    special: false,
  },
  [PlayerAttack.RAPIER]: {
    tagColor: 'red',
    letter: 'R',
    ranged: false,
    special: false,
  },
  [PlayerAttack.SAELDOR]: {
    tagColor: 'red',
    letter: 'B',
    ranged: false,
    special: false,
  },
  [PlayerAttack.SANG]: {
    tagColor: 'blue',
    letter: 'T',
    ranged: true,
    special: false,
  },
  [PlayerAttack.SANG_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.SCEPTRE_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.SCYTHE]: {
    tagColor: 'red',
    letter: 'S',
    ranged: false,
    special: false,
  },
  [PlayerAttack.SCYTHE_UNCHARGED]: {
    tagColor: 'red',
    letter: 's',
    ranged: false,
    special: false,
  },
  [PlayerAttack.SGS_SMACK]: {
    tagColor: 'yellow',
    letter: 'sgs',
    ranged: false,
    special: false,
  },
  [PlayerAttack.SGS_SPEC]: {
    tagColor: 'yellow',
    letter: 'SGS',
    ranged: false,
    special: true,
  },
  [PlayerAttack.SHADOW]: {
    tagColor: 'blue',
    letter: 'Sh',
    ranged: true,
    special: false,
  },
  [PlayerAttack.SHADOW_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.SOTD_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.SOULREAPER_AXE]: {
    tagColor: 'red',
    letter: 'AXE',
    ranged: false,
    special: false,
  },
  [PlayerAttack.STAFF_OF_LIGHT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.STAFF_OF_LIGHT_SWIPE]: {
    tagColor: 'blue',
    letter: 'SOL',
    ranged: false,
    special: false,
  },
  [PlayerAttack.SWIFT_BLADE]: {
    tagColor: 'red',
    letter: 'SB',
    ranged: false,
    special: false,
  },
  [PlayerAttack.TENT_WHIP]: {
    tagColor: 'red',
    letter: 'TW',
    ranged: false,
    special: false,
  },
  [PlayerAttack.TOXIC_TRIDENT]: {
    tagColor: 'blue',
    letter: 'T',
    ranged: true,
    special: false,
  },
  [PlayerAttack.TOXIC_TRIDENT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.TOXIC_STAFF_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.TOXIC_STAFF_SWIPE]: {
    tagColor: 'blue',
    letter: 'TS',
    ranged: false,
    special: false,
  },
  [PlayerAttack.TRIDENT]: {
    tagColor: 'blue',
    letter: 'T',
    ranged: true,
    special: false,
  },
  [PlayerAttack.TRIDENT_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.TONALZTICS_AUTO]: {
    tagColor: 'green',
    letter: 'ga',
    ranged: true,
    special: false,
  },
  [PlayerAttack.TONALZTICS_SPEC]: {
    tagColor: 'green',
    letter: 'G',
    ranged: true,
    special: true,
  },
  [PlayerAttack.TONALZTICS_UNCHARGED]: {
    tagColor: 'green',
    letter: 'g',
    ranged: true,
    special: true,
  },
  [PlayerAttack.TWISTED_BOW]: {
    tagColor: 'green',
    letter: 'TB',
    ranged: true,
    special: false,
  },
  [PlayerAttack.VENATOR_BOW]: {
    tagColor: 'green',
    letter: 'VB',
    ranged: true,
    special: false,
  },
  [PlayerAttack.VOLATILE_NM_BARRAGE]: {
    tagColor: 'blue',
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.VOLATILE_NM_BASH]: {
    tagColor: 'blue',
    letter: 'vnm',
    ranged: false,
    special: false,
  },
  [PlayerAttack.VOLATILE_NM_SPEC]: {
    tagColor: 'blue',
    letter: 'VNM',
    ranged: true,
    special: true,
  },
  [PlayerAttack.ZCB_SPEC]: {
    tagColor: 'green',
    letter: 'ZC',
    ranged: true,
    special: true,
  },
  [PlayerAttack.UNKNOWN_BARRAGE]: {
    tagColor: undefined,
    letter: 'F',
    ranged: true,
    special: false,
  },
  [PlayerAttack.UNKNOWN_BOW]: {
    tagColor: 'green',
    letter: 'UNK',
    ranged: true,
    special: false,
  },
  [PlayerAttack.UNKNOWN_POWERED_STAFF]: {
    tagColor: 'blue',
    letter: 'UNK',
    ranged: true,
    special: false,
  },
  [PlayerAttack.UNKNOWN]: {
    tagColor: undefined,
    letter: 'UNK',
    ranged: false,
    special: false,
  },
};

const makeCellImage = (playerAttack: Attack, memes: BlertMemes) => {
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
          height={25}
          width={25}
        />
      );
    }

    switch (playerAttack.type) {
      case PlayerAttack.SANG_BARRAGE:
      case PlayerAttack.SHADOW_BARRAGE:
      case PlayerAttack.STAFF_OF_LIGHT_BARRAGE:
      case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
      case PlayerAttack.TOXIC_STAFF_BARRAGE:
      case PlayerAttack.TRIDENT_BARRAGE:
      case PlayerAttack.KODAI_BARRAGE:
      case PlayerAttack.SCEPTRE_BARRAGE:
      case PlayerAttack.SOTD_BARRAGE:
      case PlayerAttack.VOLATILE_NM_BARRAGE:
      case PlayerAttack.UNKNOWN_BARRAGE:
        infoIcon = (
          <Image
            className={styles.attackTimeline__CellImage__InfoIcon}
            src={'/barrage.png'}
            alt="Barrage"
            height={25}
            width={25}
          />
        );
        break;

      case PlayerAttack.BGS_SMACK:
      case PlayerAttack.HAMMER_BOP:
        if (playerAttack.target !== undefined) {
          const npcId = playerAttack.target.id;
          if (!Npc.isNylocas(npcId) && !Npc.isVerzikMatomenos(npcId)) {
            troll = true;
          }
        }
        break;

      case PlayerAttack.CHALLY_SWIPE:
        if (playerAttack.target !== undefined) {
          if (!Npc.isVerzikMatomenos(playerAttack.target.id)) {
            troll = true;
          }
        }
        break;

      case PlayerAttack.KODAI_BASH:
      case PlayerAttack.VOLATILE_NM_BASH:
      case PlayerAttack.SCYTHE_UNCHARGED:
      case PlayerAttack.TONALZTICS_AUTO:
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
        <div className={styles.npcAttackCellImage}>
          <Image
            src={customImageUrl}
            alt="Unknown attack"
            fill
            style={{ objectFit: 'contain' }}
          />
        </div>
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
};

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
    case PlayerAttack.BGS_SMACK:
    case PlayerAttack.SGS_SMACK:
      return 'smacked';
    case PlayerAttack.BGS_SPEC:
      return "BGS'd";
    case PlayerAttack.BLOWPIPE:
      return 'piped';
    case PlayerAttack.CHALLY_SPEC:
      return 'challied';
    case PlayerAttack.CHIN_BLACK:
    case PlayerAttack.CHIN_GREY:
    case PlayerAttack.CHIN_RED:
      return 'chinned';
    case PlayerAttack.CLAW_SCRATCH:
      return 'claw scratched';
    case PlayerAttack.CLAW_SPEC:
      return 'clawed';
    case PlayerAttack.DAWN_SPEC:
      return 'dawned';
    case PlayerAttack.DINHS_SPEC:
      return 'dinhsed';
    case PlayerAttack.FANG_STAB:
      return 'fanged';
    case PlayerAttack.HAMMER_BOP:
      return 'hammer bopped';
    case PlayerAttack.HAMMER_SPEC:
      return 'hammered';
    case PlayerAttack.HAM_JOINT:
      return 'hammed';
    case PlayerAttack.KICK:
      return 'kicked';
    case PlayerAttack.PUNCH:
      return 'punched';
    case PlayerAttack.KODAI_BARRAGE:
    case PlayerAttack.SANG_BARRAGE:
    case PlayerAttack.SCEPTRE_BARRAGE:
    case PlayerAttack.SHADOW_BARRAGE:
    case PlayerAttack.SOTD_BARRAGE:
    case PlayerAttack.STAFF_OF_LIGHT_BARRAGE:
    case PlayerAttack.TOXIC_TRIDENT_BARRAGE:
    case PlayerAttack.TOXIC_STAFF_BARRAGE:
    case PlayerAttack.TRIDENT_BARRAGE:
    case PlayerAttack.VOLATILE_NM_BARRAGE:
    case PlayerAttack.UNKNOWN_BARRAGE:
      return 'froze';
    case PlayerAttack.KODAI_BASH:
      return 'kodai bashed';
    case PlayerAttack.RAPIER:
      return 'stabbed';
    case PlayerAttack.SAELDOR:
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
      return 'cleaved';
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
      return 'glaive tossed';
    case PlayerAttack.TONALZTICS_SPEC:
      return 'glaived';
    case PlayerAttack.BOWFA:
    case PlayerAttack.TWISTED_BOW:
    case PlayerAttack.VENATOR_BOW:
    case PlayerAttack.UNKNOWN_BOW:
      return 'bowed';
    case PlayerAttack.VOLATILE_NM_BASH:
      return 'volatile bashed';
    case PlayerAttack.VOLATILE_NM_SPEC:
      return 'volatiled';
    case PlayerAttack.ZCB_SPEC:
      return "ZCB'd";
    case PlayerAttack.TOXIC_TRIDENT:
    case PlayerAttack.TRIDENT:
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
      cellImage = npcAttackImage(npcState.attack);
      const npcName = getNpcDefinition(npcState.npcId)?.fullName ?? 'Unknown';

      tooltipId = `npc-${npcState.roomId}-${npcState.tick}`;
      tooltip = (
        <LigmaTooltip tooltipId={tooltipId}>
          <div className={styles.npcTooltip}>
            <button>{npcName}</button>
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
        </LigmaTooltip>
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
    const playerIsOffCooldown =
      playerState.player.offCooldownTick <= playerState.tick;

    const diedThisTick = playerState.diedThisTick;
    const playerIsDead = playerState.isDead;

    let cellImage;

    if (playerState.attack !== undefined) {
      const attack = playerState.attack;
      cellImage = makeCellImage(attack, memes);

      let targetName = 'Unknown';
      let targetHp: number | undefined = undefined;
      const maybeTarget = attack.target;
      if (maybeTarget !== undefined) {
        const roomNpc = npcs.get(maybeTarget.roomId);
        if (roomNpc !== undefined) {
          targetName = npcFriendlyName(roomNpc);
          targetHp =
            roomNpc.stateByTick[playerState.tick]?.hitpoints.percentage();
        }
      }

      tooltipId = `player-${username}-attack-${playerState.tick}`;
      const ranged = ATTACK_METADATA[attack.type]?.ranged ?? false;
      const distance = attack.distanceToTarget;

      tooltip = (
        <LigmaTooltip tooltipId={tooltipId}>
          <div className={styles.playerTooltip}>
            <button onClick={() => setSelectedPlayer(username)}>
              {username}
            </button>
            <span>{playerAttackVerb(attack.type)}</span>
            <button>
              {targetName}
              {targetHp && ` (${targetHp.toFixed(2)}%)`}
            </button>
            {ranged && (
              <span>{`from ${distance} tile${distance === 1 ? '' : 's'} away`}</span>
            )}
          </div>
        </LigmaTooltip>
      );
    } else if (diedThisTick) {
      tooltipId = `player-${username}-death`;

      tooltip = (
        <LigmaTooltip tooltipId={tooltipId}>
          <div className={styles.playerTooltip}>
            <button onClick={() => setSelectedPlayer(username)}>
              {username}
            </button>
            <span>died</span>
          </div>
        </LigmaTooltip>
      );

      cellImage = (
        <div className={styles.attackTimeline__CellImage}>
          <div className={styles.npcAttackCellImage}>
            <Image
              src="/skull.webp"
              alt="Player died"
              fill
              style={{ objectFit: 'contain' }}
            />
          </div>
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

  const tooltipId = `atk-timeline-split-${split?.splitName}-tooltip`;

  return (
    <div
      key={`attackTimeline__${columnTick}`}
      className={styles.attackTimeline__Column}
      style={{ width: cellSize, marginRight: COLUMN_MARGIN }}
    >
      {split !== undefined && (
        <div className={styles.attackTimeline__RoomSplit}>
          <LigmaTooltip openOnClick tooltipId={tooltipId}>
            {split.splitName}
          </LigmaTooltip>
          <span data-tooltip-id={tooltipId}>{split.splitName}</span>
          <div className={styles.splitIndicatorWrapper}>
            <div className={styles.splitIndicatorPt1}></div>
            <div className={styles.splitIndicatorPt2}></div>
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
  timelineTicks: number;
  splits: TimelineSplit[];
  backgroundColors?: TimelineColor[];
  playerState: PlayerStateMap;
  updateTickOnPage: (tick: number) => void;
  npcs: RoomNpcMap;
  actorContext: RoomActorState;
  cellSize: number;
};

function BaseTimeline(props: BaseTimelineProps) {
  const {
    timelineTicks,
    splits,
    backgroundColors,
    playerState,
    updateTickOnPage,
    npcs,
    actorContext,
    cellSize,
  } = props;

  const memes = useContext(MemeContext);

  const attackTimelineColumnElements = [];
  for (let i = 0; i < timelineTicks; i++) {
    const tick = i + 1;

    let potentialSplit = undefined;

    for (const split of splits) {
      if (split.tick === tick) {
        potentialSplit = split;
      }
    }

    const color = backgroundColors?.find((c) => {
      const length = c.length ?? 1;
      return tick >= c.tick && tick < c.tick + length;
    })?.backgroundColor;

    attackTimelineColumnElements.push(
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

interface AttackTimelineProps {
  currentTick: number;
  playing: boolean;
  playerState: PlayerStateMap;
  timelineTicks: number;
  splits: TimelineSplit[];
  backgroundColors?: TimelineColor[];
  updateTickOnPage: (tick: number) => void;
  npcs: RoomNpcMap;
  cellSize?: number;
}

export function BossPageAttackTimeline(props: AttackTimelineProps) {
  const {
    currentTick,
    playerState,
    updateTickOnPage,
    timelineTicks,
    backgroundColors,
    splits,
    npcs,
    cellSize = DEFAULT_CELL_SIZE,
  } = props;

  const totalColumnWidth = cellSize + COLUMN_MARGIN;

  const actorContext = useContext(ActorContext);

  const attackTimelineRef = useRef<HTMLDivElement>(null);
  const currentTickColumnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  }, [currentTick, totalColumnWidth]);

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

  const legendElements = [];

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
        timelineTicks={timelineTicks}
        splits={splits}
        backgroundColors={backgroundColors}
        playerState={playerState}
        updateTickOnPage={updateTickOnPage}
        npcs={npcs}
        actorContext={actorContext}
        cellSize={cellSize}
      />
    ),
    [
      timelineTicks,
      splits,
      backgroundColors,
      playerState,
      updateTickOnPage,
      npcs,
      actorContext,
    ],
  );

  const activeColumnIndicator = (
    <div
      style={{
        left: totalColumnWidth * (currentTick - 1) + 5,
        height: legendElements.length * totalColumnWidth + 40,
        width: totalColumnWidth + 5,
      }}
      className={styles.attackTimeline__ColumnActiveIndicator}
      ref={currentTickColumnRef}
    />
  );
  const deferredColumnIndicator = useDeferredValue(activeColumnIndicator);

  return (
    <CollapsiblePanel
      panelTitle="Room Timeline"
      maxPanelHeight={1000}
      defaultExpanded={true}
      className={styles.attackTimeline}
      panelWidth="100%"
    >
      <div className={styles.attackTimeline__Inner}>
        <div className={styles.attackTimeline__Legend}>{legendElements}</div>
        <HorizontalScrollable
          className={styles.attackTimeline__Scrollable}
          customRef={attackTimelineRef}
        >
          {deferredColumnIndicator}
          {memoizedBaseTimeline}
        </HorizontalScrollable>
      </div>
    </CollapsiblePanel>
  );
}
