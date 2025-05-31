import Link from 'next/link';
import Image from 'next/image';

import { MAIN_LOGO } from './logo';
import styles from './not-found.module.scss';

export default function NotFound() {
  return (
    <div className={styles.notFound}>
      <div className={styles.content}>
        <Image
          src={MAIN_LOGO}
          alt="Blert Logo"
          width={100}
          height={100}
          style={{ objectFit: 'contain' }}
        />
        <h1>404</h1>
        <h2>Page Not Found</h2>
        <p>
          Looks like you&apos;ve wandered into an empty room of the Theatre.
          <br />
          Let&apos;s get you back to safety.
        </p>
        <Link href="/" className={styles.homeButton}>
          <i className="fas fa-home" />
          Return Home
        </Link>
      </div>
    </div>
  );
}
