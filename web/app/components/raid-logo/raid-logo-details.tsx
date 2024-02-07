import Image from 'next/image';

import styles from './style.module.scss';

export function RaidLogo() {
  return (
    <div className={styles.raid__Title}>
      <Image
        className={styles.raid__Logo}
        src="/logo_tob.webp"
        alt="tob icon"
        height={200}
        width={200}
      />
    </div>
  );
}
