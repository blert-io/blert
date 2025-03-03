'use client';

import {
  Challenge,
  ChallengeType,
  ColosseumChallenge,
  Stage,
  TobRaid,
} from '@blert/common';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useContext, useEffect, useRef } from 'react';

import { ChallengeContext } from '@/challenge-context';
import { useDisplay } from '@/display';
import { challengeUrl } from '@/utils/url';

import MaidenIcon from '@/svg/maiden.svg';
import BloatIcon from '@/svg/bloat.svg';
import NylocasIcon from '@/svg/nyloking.svg';
import SotetsegIcon from '@/svg/sotetseg.svg';
import XarpusIcon from '@/svg/xarpus.svg';
import VerzikIcon from '@/svg/verzik.svg';

import styles from './style.module.scss';

interface ChallengeNavProps {
  challengeId: string;
}

interface NavItem {
  path: string;
  label: string;
  stage: Stage;
  icon: React.ReactNode;
  styles?: React.CSSProperties;
}

const TOB_NAV_ITEMS: NavItem[] = [
  {
    path: 'overview',
    label: 'Overview',
    stage: Stage.UNKNOWN,
    icon: <i className="fa-solid fa-list" />,
  },
  {
    path: 'maiden',
    label: 'Maiden',
    stage: Stage.TOB_MAIDEN,
    icon: <MaidenIcon height={24} width={24} />,
  },
  {
    path: 'bloat',
    label: 'Bloat',
    stage: Stage.TOB_BLOAT,
    icon: <BloatIcon height={24} width={24} />,
  },
  {
    path: 'nylocas',
    label: 'Nylocas',
    stage: Stage.TOB_NYLOCAS,
    icon: <NylocasIcon height={24} width={24} />,
  },
  {
    path: 'sotetseg',
    label: 'Sotetseg',
    stage: Stage.TOB_SOTETSEG,
    icon: <SotetsegIcon height={24} width={24} />,
  },
  {
    path: 'xarpus',
    label: 'Xarpus',
    stage: Stage.TOB_XARPUS,
    icon: <XarpusIcon height={24} width={24} />,
  },
  {
    path: 'verzik',
    label: 'Verzik',
    stage: Stage.TOB_VERZIK,
    icon: <VerzikIcon height={24} width={24} />,
  },
];

const COLOSSEUM_NAV_ITEMS: NavItem[] = [
  {
    path: 'overview',
    label: 'Overview',
    stage: Stage.UNKNOWN,
    icon: <i className="fa-solid fa-list" />,
  },
  {
    path: 'waves/1',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_1,
    icon: <span className={styles.waveIcon}>I</span>,
  },
  {
    path: 'waves/2',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_2,
    icon: <span className={styles.waveIcon}>II</span>,
  },
  {
    path: 'waves/3',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_3,
    icon: <span className={styles.waveIcon}>III</span>,
  },
  {
    path: 'waves/4',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_4,
    icon: <span className={styles.waveIcon}>IV</span>,
  },
  {
    path: 'waves/5',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_5,
    icon: <span className={styles.waveIcon}>V</span>,
  },
  {
    path: 'waves/6',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_6,
    icon: <span className={styles.waveIcon}>VI</span>,
  },
  {
    path: 'waves/7',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_7,
    icon: <span className={styles.waveIcon}>VII</span>,
  },
  {
    path: 'waves/8',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_8,
    icon: <span className={styles.waveIcon}>VIII</span>,
  },
  {
    path: 'waves/9',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_9,
    icon: <span className={styles.waveIcon}>IX</span>,
  },
  {
    path: 'waves/10',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_10,
    icon: <span className={styles.waveIcon}>X</span>,
  },
  {
    path: 'waves/11',
    label: '',
    stage: Stage.COLOSSEUM_WAVE_11,
    icon: <span className={styles.waveIcon}>XI</span>,
  },
  {
    path: 'waves/12',
    label: 'Sol Heredit',
    stage: Stage.COLOSSEUM_WAVE_12,
    icon: <i className="fa-solid fa-crown" style={{ fontSize: '1.1em' }} />,
    styles: { fontFamily: 'var(--font-cinzel), serif' },
  },
];

export default function ChallengeNav({ challengeId }: ChallengeNavProps) {
  const pathname = usePathname();
  const display = useDisplay();

  const [challenge] = useContext(ChallengeContext) as [
    Challenge | null,
    unknown,
  ];
  const navRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    // Scroll active item into view on mobile.
    if (display.isCompact() && activeItemRef.current && navRef.current) {
      const nav = navRef.current;
      const item = activeItemRef.current;
      const itemLeft = item.offsetLeft;
      const navWidth = nav.offsetWidth;
      const itemWidth = item.offsetWidth;

      nav.scrollLeft = itemLeft - (navWidth - itemWidth) / 2;
    }
  }, [pathname, display]);

  if (challenge === null) {
    return null;
  }

  let navItems: NavItem[] = [];

  switch (challenge.type) {
    case ChallengeType.TOB:
      navItems = TOB_NAV_ITEMS;
      break;
    case ChallengeType.COLOSSEUM:
      navItems = COLOSSEUM_NAV_ITEMS;
      break;
  }

  const isStageAccessible = (stage: Stage): boolean => {
    if (stage === Stage.UNKNOWN) {
      return true;
    }

    switch (challenge.type) {
      case ChallengeType.TOB: {
        const rooms = (challenge as TobRaid).tobRooms;

        switch (stage) {
          case Stage.TOB_MAIDEN:
            return !!rooms.maiden;
          case Stage.TOB_BLOAT:
            return !!rooms.bloat;
          case Stage.TOB_NYLOCAS:
            return !!rooms.nylocas;
          case Stage.TOB_SOTETSEG:
            return !!rooms.sotetseg;
          case Stage.TOB_XARPUS:
            return !!rooms.xarpus;
          case Stage.TOB_VERZIK:
            return !!rooms.verzik;
          default:
            return false;
        }
      }
      case ChallengeType.COLOSSEUM: {
        const waves = (challenge as ColosseumChallenge).colosseum.waves;
        const offset = stage - Stage.COLOSSEUM_WAVE_1;
        return offset < waves.length;
      }
    }

    return false;
  };

  return (
    <nav className={styles.nav} data-blert-disable-sidebar="true">
      <div className={styles.navItems} ref={navRef}>
        {navItems.map((item) => {
          const path = `${challengeUrl(challenge.type, challengeId)}/${item.path}`;
          const isAccessible = isStageAccessible(item.stage);
          const isActive = pathname === path;

          return (
            <Link
              key={item.stage}
              href={isAccessible ? path : '#'}
              className={`${styles.navItem} ${isActive ? styles.active : ''} ${
                !isAccessible ? styles.disabled : ''
              }`}
              onClick={(e) => {
                if (!isAccessible) {
                  e.preventDefault();
                }
              }}
              ref={isActive ? activeItemRef : null}
              style={item.styles}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
