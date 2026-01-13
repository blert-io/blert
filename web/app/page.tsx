import { ChallengeStatus, SplitType } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import {
  aggregateChallenges,
  findBestSplitTimes,
  RankedSplit,
} from './actions/challenge';
import CollapsiblePanel from './components/collapsible-panel';
import {
  ActivityFeed,
  ChallengeStats,
  GuidesCard,
  LeaderboardCard,
} from './home-cards';

import styles from './home.module.scss';

const LEADERBOARD_SCALES = [5, 4, 3, 2];

export default async function Home() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const statsQueries = Promise.all([
    aggregateChallenges(
      { startTime: ['>=', today] },
      { '*': 'count' },
      {},
      'scale',
    ),
    aggregateChallenges(
      { startTime: ['>=', today] },
      { '*': 'count' },
      {},
      'status',
    ),
  ]);

  const leaderboardQueries = Promise.all(
    LEADERBOARD_SCALES.map((scale) =>
      findBestSplitTimes([SplitType.TOB_REG_CHALLENGE], scale, 3, today),
    ),
  );

  const [[byScale, byStatus], leaderboardData] = await Promise.all([
    statsQueries,
    leaderboardQueries,
  ]);

  let totalChallenges = 0;
  let mostPopularScale = 0;
  let mostPopularScaleCount = 0;
  Object.entries(byScale ?? {}).forEach(([scale, count]) => {
    totalChallenges += count['*'].count;
    if (count['*'].count > mostPopularScaleCount) {
      mostPopularScale = parseInt(scale);
      mostPopularScaleCount = count['*'].count;
    }
  });
  const stats = {
    total: totalChallenges,
    completions: byStatus?.[ChallengeStatus.COMPLETED]?.['*']?.count ?? 0,
    mostPopularScale: {
      scale: mostPopularScale,
      percentage: (mostPopularScaleCount / totalChallenges) * 100,
    },
  };

  const leaderboards = leaderboardData.map((res, i) => ({
    scale: 5 - i,
    entries: (res[SplitType.TOB_REG_CHALLENGE] ?? []).map(
      (entry: RankedSplit, i: number) => ({
        rank: i + 1,
        time: entry.ticks,
        party: entry.party,
        uuid: entry.uuid,
        date: entry.date,
      }),
    ),
  }));

  return (
    <div className={styles.home}>
      <div className={styles.homeInner}>
        <div className={styles.registerCta}>
          <div className={styles.ctaContent}>
            <h1>Track Your PvM Progress</h1>
            <p>
              Join hundreds of players using Blert to analyze and improve their
              Theatre of Blood raids.
            </p>
          </div>
          <div className={styles.ctaButtons}>
            <Link href="/register" className={styles.primaryButton}>
              Create Account <i className="fas fa-arrow-right" />
            </Link>
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

        <div className={styles.statsGrid}>
          <ChallengeStats initialStats={stats} />
          <GuidesCard />
          <LeaderboardCard initialLeaderboards={leaderboards} />
        </div>

        <ActivityFeed />

        <CollapsiblePanel
          panelTitle="Status Updates"
          maxPanelHeight={9999}
          defaultExpanded
          className={styles.statusPanel}
          disableExpansion
          panelWidth="auto"
        >
          <div className={styles.homeOverviewInner}>
            <div className={styles.statusSection}>
              <div className={styles.statusCard}>
                <h3 className={`${styles.statusHeading} ${styles.info}`}>
                  🔧 Service Update
                </h3>
                <span className={styles.statusTimestamp}>
                  Last updated: Feb 26, 2025 17:00 UTC
                </span>
                <ul className={styles.statusList}>
                  <li>
                    Jagex have corrected the issue with NPCs and player events
                    being sent to clients, so Blert is once again recording data
                    correctly.
                  </li>
                  <li>
                    Blert is now functioning properly for all players, and
                    recording challenges as a spectator has been re-enabled.
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel
          panelTitle="About Blert"
          maxPanelHeight={9999}
          defaultExpanded
          className={styles.aboutPanel}
        >
          <div className={styles.aboutContent}>
            <div className={styles.mascot}>
              <Image
                src="/tobdataegirl.png"
                alt="Tob Data Egirl waving"
                width={200}
                height={200}
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
                  <li>Contribute code (Java, React, Next.js)</li>
                  <li>Provide UX feedback</li>
                  <li>Suggest new features</li>
                  <li>Get help with the plugin</li>
                </ul>
              </div>
            </div>
          </div>
        </CollapsiblePanel>
      </div>
    </div>
  );
}
