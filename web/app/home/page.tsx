import Image from 'next/image';
import Link from 'next/link';

import { getSignedInUserId } from '@/actions/users';
import Card from '@/components/card';
import { ActivityFeed, GuidesCard, HomeCards } from './home-cards';

import styles from './style.module.scss';

export default async function Home() {
  const isLoggedIn = (await getSignedInUserId()) !== null;

  return (
    <div className={styles.home}>
      <div className={styles.homeInner}>
        <div className={styles.registerCta}>
          <div className={styles.ctaContent}>
            <h1>Track Your PvM Progress</h1>
            <p>
              Join hundreds of players using Blert to analyze and improve their
              Old School RuneScape PvM abilities.
            </p>
          </div>
          <div className={styles.ctaButtons}>
            {isLoggedIn ? (
              <Link href="/" className={styles.primaryButton}>
                See Your Dashboard <i className="fas fa-arrow-right" />
              </Link>
            ) : (
              <Link href="/register" className={styles.primaryButton}>
                Create Account <i className="fas fa-arrow-right" />
              </Link>
            )}
            <Link
              href="https://runelite.net/plugin-hub/show/blert"
              className={styles.secondaryButton}
              target="_blank"
              rel="noreferrer noopener"
            >
              Get Plugin <i className="fas fa-external-link-alt" />
            </Link>
          </div>
        </div>

        <HomeCards />

        <ActivityFeed />

        <GuidesCard />

        <Card
          header={{ title: 'Status Updates' }}
          className={styles.statusPanel}
        >
          <div className={styles.statusCard}>
            <h3 className={styles.statusHeading}>🎉 Blert is Live!</h3>
            <span className={styles.statusTimestamp}>
              Last updated: Jan 14, 2026 05:00 UTC
            </span>
            <ul className={styles.statusList}>
              <li>
                Blert is now available on the{' '}
                <a
                  href="https://runelite.net/plugin-hub/show/blert"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  RuneLite Plugin Hub
                </a>
                ! Search for &quot;Blert&quot; in the Plugin Hub to install.
              </li>
              <li>
                Join our{' '}
                <a
                  href="https://discord.gg/c5Hgv3NnYe"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Discord server
                </a>{' '}
                to get an API key and start tracking your raids.
              </li>
            </ul>
          </div>
        </Card>

        <Card header={{ title: 'About Blert' }} className={styles.aboutPanel}>
          <div className={styles.aboutContent}>
            <div className={styles.mascot}>
              <Image
                src="/tobdataegirl.png"
                alt="Tob Data Egirl waving"
                width={256}
                height={244}
                style={{ objectFit: 'contain' }}
              />
            </div>

            <div className={styles.aboutText}>
              <h2>What is Blert?</h2>
              <p>
                Blert is a RuneLite plugin, data analysis pipeline, and web tool
                for tracking and analyzing OSRS endgame PvM content. Originally
                focused on Theatre of Blood, it now aims to support all
                challenging PvM content in Old School RuneScape.
              </p>

              <h2>Our Goal</h2>
              <p>
                We aim to be the{' '}
                <Link
                  href="https://wiseoldman.net/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Wise Old Man
                </Link>{' '}
                of PvM data analysis, similar to{' '}
                <Link
                  href="https://warcraftlogs.com/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Warcraft Logs
                </Link>{' '}
                for WoW. Our tools help players improve their performance and
                learn from their experiences.
              </p>

              <div className={styles.helpSection}>
                <h2>Get Involved</h2>
                <p>
                  Join our{' '}
                  <a
                    href="https://discord.gg/c5Hgv3NnYe"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Discord Server
                  </a>{' '}
                  to:
                </p>
                <ul>
                  <li>
                    <i className="fas fa-code" style={{ top: 1 }} /> Contribute
                    code (Java, React, Next.js)
                  </li>
                  <li>
                    <i className="fas fa-comments" /> Provide UX feedback
                  </li>
                  <li>
                    <i className="fas fa-lightbulb" /> Suggest new features
                  </li>
                  <li>
                    <i className="fas fa-question-circle" /> Get help with the
                    plugin
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
