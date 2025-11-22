'use client';

import Image from 'next/image';
import { useContext } from 'react';

import { DisplayContext } from '../../display';
import { PvMContent } from './pvm-content';

import styles from './style.module.scss';

interface PvMContentLogoProps {
  pvmContent: PvMContent;
  className?: string;
  height?: number;
  width?: number;
  simple?: boolean;
}

const getPvMContentLogo = (pvmContent: PvMContent) => {
  switch (pvmContent) {
    case PvMContent.TheatreOfBlood:
      return '/logo_tob.webp';
    case PvMContent.ChambersOfXeric:
      return '/logo_cox.webp';
    case PvMContent.TombsOfAmascut:
      return '/logo_toa.webp';
    case PvMContent.Inferno:
      return '/inferno.png';
    case PvMContent.Colosseum:
      return '/varlamore.png';
    case PvMContent.Mokhaiotl:
      return '/images/mokhaiotl.webp';
  }
};

export function PvMContentLogo(props: PvMContentLogoProps) {
  const display = useContext(DisplayContext);

  const {
    pvmContent,
    className,
    height: initialHeight = 300,
    width = 890,
    simple = false,
  } = props;

  let height = initialHeight;
  if (display.isCompact()) {
    height = Math.floor(height / 1.5);
  }

  const logoSrc = getPvMContentLogo(pvmContent);

  const classNames = [styles.raid__Title];
  if (className) {
    classNames.push(className);
  }
  if (simple) {
    classNames.push(styles.simple);
  }

  return (
    <div className={classNames.join(' ')} style={{ height, width }}>
      <Image
        className={styles.raid__Logo}
        src={`${logoSrc}`}
        alt="pvm content icon"
        fill
        style={{ objectFit: 'contain' }}
      />
    </div>
  );
}
