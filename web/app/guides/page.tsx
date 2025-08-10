import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { basicMetadata } from '@/utils/metadata';

import styles from './style.module.scss';
import Card from '@/components/card';

export default function GuidesPage() {
  return (
    <div className={styles.guides}>
      <Card className={`${styles.guidePanel} ${styles.guidesHeader}`} primary>
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
      </Card>

      <Card className={`${styles.guidePanel} ${styles.section}`}>
        <h2>Blert Usage</h2>
        <div className={styles.description}>
          <p>
            Get the most out of your Blert plugin. From initial installation to
            advanced features, these guides will help you configure Blert for
            optimal PvM analysis and improvement.
          </p>
        </div>

        <div className={styles.usageLinks}>
          <Link className={`${styles.usageLink}`} href="/guides/blert/install">
            <div className={styles.usageLinkContent}>
              <i className="fas fa-download" />
              <div>
                <h4>Plugin Installation</h4>
                <p>
                  Step-by-step guide to installing the Blert RuneLite plugin
                </p>
              </div>
            </div>
          </Link>

          <Link
            className={`${styles.usageLink}`}
            href="/guides/blert/getting-started"
          >
            <div className={styles.usageLinkContent}>
              <i className="fas fa-play-circle" />
              <div>
                <h4>Getting Started</h4>
                <p>Basic setup and your first raid recording</p>
              </div>
            </div>
          </Link>

          {/* TODO(frolv): Add these guides back in when they are ready. */}
          {/*
          <Link
            className={`${styles.usageLink}`}
            href="/guides/blert/configuration"
          >
            <div className={styles.usageLinkContent}>
              <i className="fas fa-cog" />
              <div>
                <h4>Configuration</h4>
                <p>Customize plugin settings and recording preferences</p>
              </div>
            </div>
          </Link>

          <Link
            className={`${styles.usageLink}`}
            href="/guides/blert/analyzing-raids"
          >
            <div className={styles.usageLinkContent}>
              <i className="fas fa-chart-line" />
              <div>
                <h4>Analyzing Your Raids</h4>
                <p>How to review and interpret your recorded raid data</p>
              </div>
            </div>
          </Link>

          <Link
            className={`${styles.usageLink}`}
            href="/guides/blert/troubleshooting"
          >
            <div className={styles.usageLinkContent}>
              <i className="fas fa-wrench" />
              <div>
                <h4>Troubleshooting</h4>
                <p>Common issues and solutions for the Blert plugin</p>
              </div>
            </div>
          </Link>

          <Link
            className={`${styles.usageLink}`}
            href="/guides/blert/advanced-features"
          >
            <div className={styles.usageLinkContent}>
              <i className="fas fa-star" />
              <div>
                <h4>Advanced Features</h4>
                <p>Explore advanced plugin capabilities and integrations</p>
              </div>
            </div>
          </Link>
          */}
        </div>
      </Card>

      <h2 className={styles.sectionTitle}>Guides by Category</h2>

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
    title: 'OSRS PvM Guides & Strategies',
    description:
      "Explore Blert's growing library of Old School RuneScape PvM guides, " +
      'featuring strategies, mechanics breakdowns, gear advice, and plugin ' +
      'tips.',
  });
}
