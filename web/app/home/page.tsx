import { ChallengeType, SplitType } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';

import { findBestSplitTimes, RankedSplit } from '@/actions/challenge';
import { getSession } from '@/auth';
import { ButtonLink } from '@/components/button';
import Card from '@/components/card';
import Carousel from '@/components/carousel';
import { scaleNameAndColor } from '@/utils/challenge';
import logger from '@/utils/log';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl, playerUrl } from '@/utils/url';
import { ActivityFeed, CommunityCard, HomeCards } from './home-cards';

import styles from './style.module.scss';

const TFA_FEATURED_SCALES = [8, 7, 6, 5, 4, 3];

type ScaleTopTimes = {
  scale: number;
  splits: RankedSplit[];
};

/** Returns the TFA scales with recorded times, or `null` if loading fails. */
async function loadTfaTopTimes(): Promise<ScaleTopTimes[] | null> {
  try {
    const boards = await Promise.all(
      TFA_FEATURED_SCALES.map(async (scale) => {
        const splits = await findBestSplitTimes(
          [SplitType.TFA_CHALLENGE],
          scale,
          3,
          undefined,
          0,
        );
        return { scale, splits: splits[SplitType.TFA_CHALLENGE] ?? [] };
      }),
    );
    return boards.filter((board) => board.splits.length > 0);
  } catch (e) {
    logger.error('home_tfa_top_times_failed', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

const MEDAL_CLASSES = [styles.gold, styles.silver, styles.bronze];

function TfaTopTimes({ boards }: { boards: ScaleTopTimes[] }) {
  return (
    <div className={styles.heroTimes}>
      {boards.length > 0 ? (
        <Carousel
          autoCycle
          loop
          showArrows={false}
          label="Fastest Fractured Archive runs by scale"
        >
          {boards.map(({ scale, splits }) => (
            <div key={scale} className={styles.heroBoard}>
              <div className={styles.heroBoardLabel}>
                <span className={styles.heroBoardScale}>
                  {scaleNameAndColor(scale)[0]}
                </span>
                <span>Fastest completions</span>
              </div>
              {splits.map((split, i) => (
                <Link
                  key={split.uuid}
                  href={challengeUrl(ChallengeType.TFA, split.uuid)}
                  className={styles.heroTime}
                >
                  <i className={`fas fa-medal ${MEDAL_CLASSES[i]}`} />
                  <span className={styles.heroTimeText}>
                    <span className={styles.heroTimeValue}>
                      {ticksToFormattedSeconds(split.ticks)}
                    </span>
                    <span className={styles.heroParty}>
                      {split.party.map((p) => p.username).join(', ')}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </Carousel>
      ) : (
        <div className={styles.heroTimesEmpty}>
          <i className="fas fa-trophy" />
          No completions recorded yet. Record a run to set the first time!
        </div>
      )}
    </div>
  );
}

const SETUP_STEPS = [
  {
    title: 'Install Blert in RuneLite',
    description: 'Search for “Blert” in the Plugin Hub.',
  },
  {
    title: 'Create an account',
    description: 'Any username, no need to match your RSN.',
  },
  {
    title: 'Generate an API key',
    description: 'From your settings page.',
  },
  {
    title: 'Add the key to the plugin',
    description: 'Paste it in, then raid as normal.',
  },
];

function GettingStarted() {
  return (
    <>
      <div className={styles.startIntro}>
        <h2 id="start-heading">Track your PvM progress</h2>
        <p>
          Blert records your raids and challenges through a RuneLite plugin and
          turns every run into splits, stats, and replays.
        </p>
      </div>
      <ol className={styles.setupSteps}>
        {SETUP_STEPS.map((step, i) => (
          <li key={step.title}>
            <span className={styles.stepNumber} aria-hidden="true">
              {i + 1}
            </span>
            <div className={styles.stepText}>
              <strong>{step.title}</strong>
              <span>{step.description}</span>
            </div>
          </li>
        ))}
      </ol>
      <div className={styles.startActions}>
        <ButtonLink href="/register" fluid>
          Create Account <i className="fas fa-arrow-right" />
        </ButtonLink>
        <ButtonLink href="/guides/blert/getting-started" simple fluid>
          <i className="fas fa-book" /> Setup Guide
        </ButtonLink>
      </div>
    </>
  );
}

type QuickLinkProps = {
  href: string;
  icon: string;
  label: string;
};

const ACCOUNT_LINKS: QuickLinkProps[] = [
  { href: '/settings/api-keys', icon: 'fas fa-key', label: 'API keys' },
  { href: '/settings', icon: 'fas fa-gear', label: 'Account settings' },
  {
    href: '/guides/blert/getting-started',
    icon: 'fas fa-book',
    label: 'Setup guide',
  },
];

function QuickLink({ href, icon, label }: QuickLinkProps) {
  return (
    <Link href={href} className={styles.quickLink}>
      <i className={icon} />
      <span>{label}</span>
      <i className="fas fa-chevron-right" />
    </Link>
  );
}

function WelcomeBack({ username }: { username: string | null }) {
  return (
    <>
      <div className={styles.startIntro}>
        <h2 id="start-heading">Welcome back</h2>
        <p>
          Check out your friends&apos; sessions and personal bests in your feed.
        </p>
      </div>
      <ButtonLink href="/" fluid>
        See Your Feed <i className="fas fa-arrow-right" />
      </ButtonLink>
      <nav className={styles.quickLinks} aria-label="Account">
        {username !== null && (
          <QuickLink
            href={playerUrl(username)}
            icon="fas fa-id-card"
            label="Your profile"
          />
        )}
        {ACCOUNT_LINKS.map((link) => (
          <QuickLink key={link.href} {...link} />
        ))}
      </nav>
    </>
  );
}

export default async function Home() {
  const [session, tfaTopTimes] = await Promise.all([
    getSession(),
    loadTfaTopTimes(),
  ]);

  return (
    <div className={styles.home}>
      <div className={styles.homeInner}>
        <div className={styles.featured}>
          <section
            className={styles.hero}
            data-challenge="tfa"
            aria-labelledby="hero-heading"
          >
            <div className={styles.heroBody}>
              <Image
                className={styles.heroArt}
                src="/images/tfa.webp"
                alt="The Fractured Archive"
                width={270}
                height={208}
                priority
              />
              <div className={styles.heroText}>
                <span className={styles.newPill}>New raid</span>
                <h1 id="hero-heading">
                  Record your runs through <span>The Fractured Archive</span>
                </h1>
                <p>
                  Blert now supports TFA. Every run you record is saved with
                  boss times, actions and deaths, and a tick-by-tick replay, so
                  your team can see exactly what happened.
                </p>
                <div className={styles.heroActions}>
                  <ButtonLink href="/raids/tfa">
                    Explore TFA <i className="fas fa-arrow-right" />
                  </ButtonLink>
                  <ButtonLink href="/leaderboards/tfa" simple>
                    <i className="fas fa-trophy" /> Leaderboards
                  </ButtonLink>
                </div>
              </div>
            </div>
            {tfaTopTimes !== null && <TfaTopTimes boards={tfaTopTimes} />}
          </section>

          <aside className={styles.startPanel} aria-labelledby="start-heading">
            {session === null ? (
              <GettingStarted />
            ) : (
              <WelcomeBack
                username={session.connectedPlayers[0]?.username ?? null}
              />
            )}
          </aside>
        </div>

        <HomeCards />

        <div className={styles.communityGrid}>
          <ActivityFeed limit={6} />
          <CommunityCard />
        </div>

        <Card
          header={{ title: 'Status Updates' }}
          className={styles.statusPanel}
        >
          <div className={styles.statusCard}>
            <h3 className={styles.statusHeading}>
              The Fractured Archive is now recorded
            </h3>
            <span className={styles.statusTimestamp}>
              Last updated: Oct 21, 2026 21:00 UTC
            </span>
            <ul className={styles.statusList}>
              <li>
                Blert now records TFA runs with boss times and full replays.
              </li>
              <li>
                Recent runs are on the <Link href="/raids/tfa">raid page</Link>,
                and the fastest times are on the{' '}
                <Link href="/leaderboards/tfa">leaderboards</Link>.
              </li>
            </ul>
          </div>

          <div className={styles.statusCard}>
            <h3 className={styles.statusHeading}>API keys without Discord</h3>
            <span className={styles.statusTimestamp}>
              Last updated: Jul 5, 2026 19:00 UTC
            </span>
            <ul className={styles.statusList}>
              <li>
                You can now generate an API key from your{' '}
                <Link href="/settings/api-keys">account settings</Link> straight
                after registering, without linking a Discord account.
              </li>
              <li>
                Linking Discord is still available and recommended for bot
                integration and account support, but it&apos;s optional.
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
