import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { basicMetadata } from '@/utils/metadata';

import styles from './style.module.scss';

export default function GuidesPage() {
  return (
    <div className={styles.guides}>
      <div className={`${styles.guidePanel} ${styles.guidesHeader}`}>
        <h1>
          <i className="fas fa-book" /> OSRS PvM Guides
        </h1>
        <div className={styles.description}>
          <p>
            Welcome to Blert&apos;s comprehensive guide collection for Old
            School RuneScape PvM content. Our guides are meticulously crafted to
            help you master challenging end-game PvM encounters, with detailed
            strategies, mechanics explanations, and role-specific advice.
          </p>
          <p>
            Each guide is regularly updated to reflect the latest meta
            strategies and game changes, ensuring you always have access to
            current, reliable information.
          </p>
          <div className={styles.notice}>
            <i className="fas fa-exclamation-circle" />
            <span>
              Blert guides are actively being developed. We are continuously
              expanding our collection and updating existing guides based on
              community feedback.
            </span>
          </div>
        </div>
      </div>

      <h2 className={styles.sectionTitle}>Available Guides</h2>

      <div className={styles.links}>
        <Link
          className={`${styles.guidePanel} ${styles.guideLink}`}
          href="/guides/tob"
        >
          <div className={styles.guideThumbnail}>
            <Image
              src="/logo_tob.webp"
              alt="Theatre of Blood"
              height={200}
              width={280}
              style={{ objectFit: 'contain' }}
            />
          </div>
          <div className={styles.guideInfo}>
            <h3>Theatre of Blood</h3>
            <p>
              Master both normal and hard mode Theatre of Blood with
              comprehensive room-by-room strategies, role guides, and gear
              setups.
            </p>
          </div>
        </Link>

        {/* Placeholder for future guides - helps with visual balance */}
        <div className={`${styles.guidePanel} ${styles.guidePlaceholder}`}>
          <p>More guides coming soon!</p>
        </div>
      </div>
    </div>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'OSRS PvM Guides',
    description:
      'Browse comprehensive, up-to-date guides for Old School RuneScape PvM content.',
  });
}
