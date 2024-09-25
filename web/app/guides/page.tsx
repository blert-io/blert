import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { basicMetadata } from '@/utils/metadata';

import styles from './style.module.scss';

export default function GuidesPage() {
  return (
    <div className={styles.guides}>
      <div className={`${styles.guidePanel} ${styles.guidesHeader}`}>
        <h1>Guides</h1>
        <p>
          Welcome to Blert&apos;s guides page, where you can find up-to-date,
          curated guides for various types of Old School RuneScape PvM content.
        </p>
        <p>
          Get started by selecting a category below to browse available guides.
        </p>
        <p style={{ fontSize: 14, fontStyle: 'italic' }}>
          Blert guides are currently a work in progress. We will continue to
          update and expand our guides over time.
        </p>
      </div>
      <div className={styles.links}>
        <Link
          className={`${styles.guidePanel} ${styles.guideLink}`}
          href="/guides/tob"
        >
          <Image
            src="/logo_tob.webp"
            alt="Theatre of Blood"
            height={200}
            width={280}
            style={{ objectFit: 'contain' }}
          />
        </Link>
      </div>
    </div>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'Guides',
    description: 'Browse top-tier guides for Old School RuneScape PvM content.',
  });
}
