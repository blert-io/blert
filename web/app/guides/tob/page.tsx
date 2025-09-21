import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import Card from '@/components/card';
import { basicMetadata } from '@/utils/metadata';

import guideStyles from '../style.module.scss';
import styles from './style.module.scss';

export default function TobGuides() {
  return (
    <div className={guideStyles.guides}>
      <Card
        className={`${guideStyles.guidePanel} ${guideStyles.guidesHeader}`}
        primary
      >
        <h1>
          <i className="fas fa-book" /> Theatre of Blood Guides
        </h1>
        <p className={styles.subtitle}>
          Our selection of guides is currently limited, but we are working hard
          to expand our collection. Check back soon!
        </p>
      </Card>

      <div className={styles.sections}>
        <Card className={`${guideStyles.guidePanel} ${styles.section}`}>
          <h2>General</h2>
          <p className={styles.sectionDesc}>
            Essential information for getting started with Theatre of Blood.
          </p>
          <div className={styles.guideGroup}>
            <ul>
              <li>
                <Link href="/guides/tob/plugins" className={styles.main}>
                  Plugins guide
                </Link>
                <p className={styles.guideDesc}>
                  Recommended RuneLite plugins and optimal settings
                </p>
              </li>
            </ul>
          </div>
        </Card>

        <Card className={`${guideStyles.guidePanel} ${styles.section}`}>
          <h2>The Nylocas</h2>
          <div className={styles.sectionImage}>
            <Image
              src="/nyloking.webp"
              alt="Nylocas"
              height={200}
              width={200}
              style={{ objectFit: 'contain' }}
            />
          </div>

          <div className={styles.guideGroup}>
            <h3>Basics</h3>
            <ul>
              <li>
                <Link
                  href="/guides/tob/nylocas/mechanics"
                  className={styles.main}
                >
                  Room Mechanics
                </Link>
                <p className={styles.guideDesc}>
                  How the Nylocas room functions
                </p>
              </li>
            </ul>
            <h3>Waves by Role</h3>
            <ul>
              <li>
                <Link href="/guides/tob/nylocas/trio" className={styles.main}>
                  Trio Waves Guide (All Roles)
                </Link>
                <p className={styles.guideDesc}>
                  Complete strategy for 3-player teams
                </p>
              </li>
              <li>
                <Link href="/guides/tob/nylocas/4s" className={styles.main}>
                  4s Waves Guide
                </Link>
                <p className={styles.guideDesc}>
                  Breakdown of the 4-player meta strategy by role
                </p>
                <ul>
                  <li>
                    <Link href="/guides/tob/nylocas/4s/mage">Mage</Link>
                  </li>
                  <li>
                    <Link href="/guides/tob/nylocas/4s/melee-freeze">
                      Melee Freeze
                    </Link>
                  </li>
                  <li>
                    <Link href="/guides/tob/nylocas/4s/ranger">Ranger</Link>
                  </li>
                  <li>
                    <Link href="/guides/tob/nylocas/4s/melee">Melee</Link>
                  </li>
                </ul>
              </li>
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}

export async function generateMetadata(_props: {}, parent: ResolvingMetadata) {
  return basicMetadata(await parent, {
    title: 'OSRS Theatre of Blood Guides & Strategies',
    description:
      "Browse Blert's growing collection of OSRS Theatre of Blood guides, " +
      'including plugins, boss mechanics, room strategies, meta roles, ' +
      'and advanced tactics.',
  });
}
