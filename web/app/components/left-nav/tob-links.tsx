'use client';

import { ChallengeType, Stage } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import { useContext } from 'react';

import { ChallengeContext } from '@/challenge-context';

import styles from './styles.module.scss';
import { usePathname } from 'next/navigation';

// ToB paths are of the form /raids/tob/[raidId]/[page].
const TOB_RAID_PATH =
  /^(\/raids\/tob\/[a-fA-f0-9-]+)\/(overview|maiden|bloat|nylocas|sotetseg|xarpus|verzik)$/;

const TOB_RAID_PAGES = [
  'Maiden',
  'Bloat',
  'Nylocas',
  'Sotetseg',
  'Xarpus',
  'Verzik',
];

export default function TobLinks() {
  const [raid] = useContext(ChallengeContext);

  const pathname = usePathname();
  const matches = pathname.match(TOB_RAID_PATH);
  const raidStem = matches?.at(1);
  const room = matches?.at(2);

  const viewingTob = raid?.type === ChallengeType.TOB;

  const roomLink = (stage: Stage | 'overview') => {
    if (stage !== 'overview' && raid!.stage < stage) {
      return null;
    }

    const pageName =
      stage === 'overview'
        ? 'Overview'
        : TOB_RAID_PAGES[stage - Stage.TOB_MAIDEN];
    const path = pageName.toLowerCase();

    const className =
      `${styles.leftNav__subMenuItem} ` +
      `${room === path && styles.leftNav__subMenuItemActive}`;

    return (
      <Link href={`${raidStem}/${path}`}>
        <div className={className}>{pageName}</div>
      </Link>
    );
  };

  return (
    <>
      <li className={styles.leftNav__menuItem}>
        <Link
          className={`${styles.leftNav__menuItemInner} ${raid !== null && styles.leftNav__menuItemInnerActive}`}
          href="/raids/tob"
        >
          <div
            className={styles.leftNav__menuItemIcon}
            style={{
              width: '40px',
              position: 'relative',
              height: '40px',
            }}
          >
            <Image
              src="/logo_tob.webp"
              alt="tob icon"
              fill
              style={{ objectFit: 'contain' }}
            />
          </div>
          <span className="active">ToB</span>
        </Link>
      </li>

      {viewingTob && (
        <li className={styles.leftNav__subMenu}>
          {roomLink('overview')}
          {roomLink(Stage.TOB_MAIDEN)}
          {roomLink(Stage.TOB_BLOAT)}
          {roomLink(Stage.TOB_NYLOCAS)}
          {roomLink(Stage.TOB_SOTETSEG)}
          {roomLink(Stage.TOB_XARPUS)}
          {roomLink(Stage.TOB_VERZIK)}
        </li>
      )}
    </>
  );
}
