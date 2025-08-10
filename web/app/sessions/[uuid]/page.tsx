import { ResolvingMetadata } from 'next';
import { notFound } from 'next/navigation';

import { loadSessionWithStats } from '@/actions/challenge';
import {
  challengeTerm,
  modeNameAndColor,
  scaleNameAndColor,
} from '@/utils/challenge';
import { partyNames } from '@/utils/challenge-description';
import { basicMetadata } from '@/utils/metadata';
import { ticksToFormattedSeconds } from '@/utils/tick';

// import ActionsBar from '../components/actions-bar';
import ChallengeAnalysis from '../components/challenge-analysis';
import ChallengesTable from '../components/challenges-table';
import MetricsGrid from '../components/metrics-grid';
import PlayerBreakdown from '../components/player-breakdown';
import SessionHeader from '../components/session-header';
import SessionTimeline from '../components/session-timeline';
import StageStats from '../components/stage-stats';
import SessionContextProvider from '../components/session-context-provider';

import styles from './style.module.scss';

type SessionPageProps = {
  params: Promise<{
    uuid: string;
  }>;
};

export default async function SessionPage({ params }: SessionPageProps) {
  const { uuid } = await params;

  const initialData = await loadSessionWithStats(uuid);
  if (initialData === null) {
    notFound();
  }

  return (
    <SessionContextProvider uuid={uuid} initialData={initialData}>
      <div className={styles.sessionPage}>
        <div className={styles.pageContainer}>
          <div className={styles.headerSection}>
            <SessionHeader />
          </div>

          <div className={styles.metricsSection}>
            <MetricsGrid />
          </div>

          <div className={styles.mainContent}>
            <div className={styles.primaryContent}>
              <SessionTimeline />
              <ChallengesTable />
            </div>

            <div className={styles.secondaryContent}>
              <StageStats />
              <PlayerBreakdown />
            </div>
          </div>

          <div className={styles.fullWidth}>
            <ChallengeAnalysis />
          </div>

          {/* TODO(frolv): Add actions bar */}
          {/* <div className={styles.actionsSection}>
            <ActionsBar />
          </div> */}
        </div>
      </div>
    </SessionContextProvider>
  );
}

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  props: SessionPageProps,
  parent: ResolvingMetadata,
) {
  const { uuid } = await props.params;

  const session = await loadSessionWithStats(uuid);
  if (session === null) {
    return null;
  }

  const stats = session.stats;

  const party = partyNames(session.party);
  const mode = modeNameAndColor(
    session.challengeType,
    session.challengeMode,
  )[0];
  const scale = scaleNameAndColor(session.scale)[0];

  const ticksOrNotApplicable = (ticks: number) =>
    ticks === 0 ? 'N/A' : ticksToFormattedSeconds(ticks);

  const description =
    `See a complete breakdown of ${party}'s ${mode} ${scale} session: ` +
    `${stats.challenges} ${challengeTerm(session.challengeType, true).toLowerCase()}, ` +
    `${stats.completions} completions (${stats.completionRate.toFixed(1)}% success). ` +
    `Fastest: ${ticksOrNotApplicable(stats.minCompletionTicks)}, ` +
    `average: ${ticksOrNotApplicable(stats.avgCompletionTicks)}, ` +
    `total deaths: ${stats.deaths}. Explore splits, deaths, player performance, ` +
    "and more on Blert, Old School RuneScape's premier PvM tracker.";

  return basicMetadata(await parent, {
    title: `${party}'s ${mode} ${scale} session`,
    description,
  });
}
