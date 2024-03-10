import Image from 'next/image';

import styles from './styles.module.scss';

export default function Home() {
  return (
    <div className={styles.home}>
      <Image
        src="/tobdataegirl.png"
        alt="Tob Data Egirl waving"
        width={430}
        height={410}
      />
      <p>TobDataEgirl welcomes you to Blert!</p>
    </div>
  );
}
