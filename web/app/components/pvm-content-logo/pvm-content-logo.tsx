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
  }
};

export function PvMContentLogo(props: PvMContentLogoProps) {
  const display = useContext(DisplayContext);

  let { pvmContent, className, height = 300, width = 890 } = props;

  if (display.isCompact()) {
    height = Math.floor(height / 1.5);
  }

  const logoSrc = getPvMContentLogo(pvmContent);

  return (
    <div
      className={`${styles.raid__Title}${className !== undefined ? ' ' + className : ''}`}
      style={{
        height,
        width: '100%',
        maxWidth: width,
      }}
    >
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
