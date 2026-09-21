import { Metadata, ResolvingMetadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import Card from '@/components/card';
import SectionTitle from '@/components/section-title';
import { basicMetadata } from '@/utils/metadata';

import styles from './style.module.scss';

export default function GuidesPage() {
  return (
    <div className={styles.guides}>
      <Card primary fixed className={styles.hero}>
        <div className={styles.titleRow}>
          <div className={styles.titleIcon}>
            <i className="fas fa-book" />
          </div>
          <h1 className={styles.title}>OSRS PvM Guides</h1>
        </div>
        <div className={styles.notice}>
          <i className="fas fa-exclamation-circle" />
          <span>
            Blert guides are actively being developed. We are continuously
            expanding our collection and updating existing guides based on
            community feedback.
            <br />
            If you&apos;d like to contribute to a guide,{' '}
            <Link
              href="https://discord.gg/c5Hgv3NnYe"
              target="_blank"
              rel="noopener noreferrer"
            >
              join our Discord <i className="fas fa-external-link-alt" />
            </Link>
            .
          </span>
        </div>
      </Card>

      <Link
        className={styles.featureCard}
        href="/guides/tob"
        data-challenge="tob"
      >
        <div className={styles.featureInfo}>
          <h2 className={styles.featureTitle}>Theatre of Blood</h2>
          <p className={styles.featureDesc}>
            Master both normal and hard mode Theatre of Blood with comprehensive
            room-by-room strategies, role guides, and gear setups.
          </p>
        </div>
        <div className={styles.featureArt}>
          <Image
            src="/logo_tob.webp"
            alt="Theatre of Blood"
            height={118}
            width={220}
            style={{ objectFit: 'contain' }}
          />
        </div>
      </Link>

      <Card fixed>
        <SectionTitle icon="fa-plug">Using Blert</SectionTitle>

        <div className={styles.usageRows}>
          <Link
            className={styles.usageRow}
            href="/guides/blert/getting-started"
          >
            <span className={styles.usageIcon}>
              <i className="fas fa-play" />
            </span>
            <span>
              <span className={styles.usageTitle}>Getting Started</span>
              <span className={styles.usageDesc}>
                Basic setup and your first raid recording
              </span>
            </span>
          </Link>

          {/* TODO(frolv): Add these guides back in when they are ready. */}
          {/*
          <Link className={styles.usageRow} href="/guides/blert/configuration">
            <span className={styles.usageIcon}>
              <i className="fas fa-cog" />
            </span>
            <span>
              <span className={styles.usageTitle}>Configuration</span>
              <span className={styles.usageDesc}>
                Customize plugin settings and recording preferences
              </span>
            </span>
          </Link>

          <Link
            className={styles.usageRow}
            href="/guides/blert/analyzing-raids"
          >
            <span className={styles.usageIcon}>
              <i className="fas fa-chart-line" />
            </span>
            <span>
              <span className={styles.usageTitle}>Analyzing Your Raids</span>
              <span className={styles.usageDesc}>
                How to review and interpret your recorded raid data
              </span>
            </span>
          </Link>

          <Link className={styles.usageRow} href="/guides/blert/troubleshooting">
            <span className={styles.usageIcon}>
              <i className="fas fa-wrench" />
            </span>
            <span>
              <span className={styles.usageTitle}>Troubleshooting</span>
              <span className={styles.usageDesc}>
                Common issues and solutions for the Blert plugin
              </span>
            </span>
          </Link>

          <Link
            className={styles.usageRow}
            href="/guides/blert/advanced-features"
          >
            <span className={styles.usageIcon}>
              <i className="fas fa-star" />
            </span>
            <span>
              <span className={styles.usageTitle}>Advanced Features</span>
              <span className={styles.usageDesc}>
                Explore advanced plugin capabilities and integrations
              </span>
            </span>
          </Link>
          */}
        </div>
      </Card>

      <div className={styles.terminator}>
        <span className={styles.terminatorDot} />
        <span>More guides coming soon</span>
      </div>
    </div>
  );
}

export async function generateMetadata(
  _props: object,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  return basicMetadata(await parent, {
    title: 'OSRS PvM Guides & Strategies',
    description:
      "Explore Blert's growing library of Old School RuneScape PvM guides, " +
      'featuring strategies, mechanics breakdowns, gear advice, and plugin ' +
      'tips.',
  });
}
