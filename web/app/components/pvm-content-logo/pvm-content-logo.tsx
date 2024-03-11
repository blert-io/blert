import Image from 'next/image';

import styles from './style.module.scss';

export enum PvMContent {
  TheatreOfBlood,
  ChambersOfXeric,
  TombsOfAmascut,
  Inferno,
  Colosseum,
}

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
  const { pvmContent, className, height = 300, width = 890 } = props;

  const logoSrc = getPvMContentLogo(pvmContent);

  return (
    <div
      className={`${styles.raid__Title}${className !== undefined ? ' ' + className : ''}`}
      style={{ height: `${height}px`, width: `${width}px` }}
    >
      <Image
        className={styles.raid__Logo}
        src={`${logoSrc}`}
        alt="pvm content icon"
        fill
        style={{ objectFit: 'cover' }}
      />
    </div>
  );
}
