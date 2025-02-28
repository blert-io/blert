'use client';

import { ChallengeType, Stage } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import { useContext } from 'react';

import { ChallengeContext } from '@/challenge-context';

import styles from './styles.module.scss';
import { usePathname } from 'next/navigation';

const COLOSSEUM_PATH =
  /^(\/challenges\/colosseum\/[a-fA-f0-9-]+)\/(overview|waves\/\d+)$/;

export default function ColosseumLinks() {
  const [colosseum] = useContext(ChallengeContext);

  const pathname = usePathname();
  const matches = pathname.match(COLOSSEUM_PATH);
  const challengeStem = matches?.at(1);
  const wave = matches?.at(2);

  const viewingColosseum = colosseum?.type === ChallengeType.COLOSSEUM;

  const waveLink = (stage: Stage | 'overview') => {
    if (stage !== 'overview' && colosseum!.stage < stage) {
      return null;
    }

    let pageName, path;
    if (stage === 'overview') {
      pageName = 'Overview';
      path = 'overview';
    } else {
      const waveNumber = stage - Stage.COLOSSEUM_WAVE_1 + 1;
      pageName = waveNumber.toString();
      path = `waves/${waveNumber}`;
    }

    const className = `${styles.wave} ${wave === path && styles.active}`;

    return (
      <Link className={className} href={`${challengeStem}/${path}`} key={stage}>
        {pageName}
      </Link>
    );
  };

  let links = [];
  if (viewingColosseum) {
    for (let i = Stage.COLOSSEUM_WAVE_1; i <= Stage.COLOSSEUM_WAVE_12; i++) {
      links.push(waveLink(i));
    }
  }

  return (
    <>
      <li className={styles.leftNav__menuItem}>
        <Link
          className={`${styles.leftNav__menuItemInner} ${viewingColosseum && styles.leftNav__menuItemInnerActive}`}
          href="/challenges/colosseum"
        >
          <div className={styles.leftNav__menuItemIcon}>
            <div className={styles.imageWrapper}>
              <Image
                src="/varlamore.png"
                alt="fortis colosseum icon"
                fill
                style={{ objectFit: 'contain' }}
              />
            </div>
          </div>
          <span className="active" style={{ top: -1 }}>
            Colosseum
          </span>
        </Link>
      </li>
      {viewingColosseum && (
        <li className={styles.leftNav__subMenu}>
          <Link href={`${challengeStem}/overview`}>
            <div
              className={`${styles.leftNav__subMenuItem} ${wave === 'overview' && styles.leftNav__subMenuItemActive}`}
            >
              Overview
            </div>
          </Link>
          <div
            className={`${styles.colosseumWaves} ${styles.leftNav__subMenuItem}`}
          >
            {links}
          </div>
        </li>
      )}
    </>
  );
}
