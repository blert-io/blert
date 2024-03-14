import Image from 'next/image';

import styles from './style.module.scss';

export default function Loading() {
  return (
    <div className={styles.loading}>
      <Image width={200} height={200} src="/loading.svg" alt="Loading..." />
    </div>
  );
}
