import { ChallengeMode, ChallengeStatus, ChallengeType } from '@blert/common';
import { Metadata } from 'next';
import Image from 'next/image';

import { aggregateChallenges } from '@/actions/challenge';
import { Comparator } from '@/actions/query';
import CollapsiblePanel from '@/components/collapsible-panel';
import Statistic from '@/components/statistic';
import { ticksToFormattedSeconds } from '@/utils/tick';

import FilteredRaidsList from './filtered-raids-list';
import RaidCharts from './raid-charts';

import styles from './style.module.scss';

function startOfDateUtc(): Date {
  let date = new Date();
  date.setUTCHours(0);
  date.setUTCMinutes(0);
  date.setUTCSeconds(0);
  date.setUTCMilliseconds(0);
  return date;
}

const TYPE_TOB: Comparator<ChallengeType> = ['==', ChallengeType.TOB];

export default async function Page() {
  const fromToday: Comparator<Date> = ['>=', startOfDateUtc()];

  const statsQuery = aggregateChallenges(
    { type: TYPE_TOB, startTime: fromToday },
    {
      '*': 'count',
      challengeTicks: 'sum',
      totalDeaths: 'sum',
    },
    {},
  );

  const raidStatusQuery = aggregateChallenges(
    { type: TYPE_TOB, startTime: fromToday },
    { '*': 'count' },
    {},
    'status',
  );
  const raidModesQuery = aggregateChallenges(
    { type: TYPE_TOB, startTime: fromToday },
    { '*': 'count' },
    {},
    'mode',
  );
  const raidScaleQuery = aggregateChallenges(
    { type: TYPE_TOB, startTime: fromToday },
    { '*': 'count' },
    {},
    'scale',
  );
  const playerQuery = aggregateChallenges(
    { type: TYPE_TOB, startTime: fromToday },
    { '*': 'count' },
    { limit: 10, sort: '-count' },
    'username',
  );

  const [todaysStats, raidModes, raidStatuses, raidScales, players] =
    await Promise.all([
      statsQuery,
      raidModesQuery,
      raidStatusQuery,
      raidScaleQuery,
      playerQuery,
    ]);

  const inProgressRaids =
    raidStatuses?.[ChallengeStatus.IN_PROGRESS]?.['*'].count ?? 0;

  const statusData = Object.entries(raidStatuses ?? {}).flatMap(([s, data]) => {
    const status = parseInt(s, 10) as ChallengeStatus;
    if (status === ChallengeStatus.IN_PROGRESS) {
      return [];
    }

    return { key: status, value: data['*'].count };
  });

  const modeData = Object.entries(raidModes ?? {}).map(([m, data]) => ({
    key: parseInt(m, 10) as ChallengeMode,
    value: data['*'].count,
  }));

  const scaleData = Object.entries(raidScales ?? {}).map(([s, data]) => ({
    key: parseInt(s, 10),
    value: data['*'].count,
  }));

  const playerData = Object.entries(players ?? {}).map(([p, data]) => ({
    key: p,
    value: data['*'].count,
  }));
  playerData.sort((a, b) => b.value - a.value);

  return (
    <div className={styles.tobPage}>
      <div className={styles.infoStatsWrapper}>
        <div className={styles.infoStats}>
          <CollapsiblePanel
            panelTitle="The Theatre Of Blood"
            maxPanelHeight={2000}
            defaultExpanded={true}
            disableExpansion={true}
          >
            <div className={styles.tobOverviewInner}>
              <Image
                src="/tobdataegirl.png"
                alt="ToB Preview"
                height={200}
                width={200}
                style={{ objectFit: 'cover' }}
                unoptimized
              />

              <div className={styles.textGreeting}>
                <p>Welcome to the Theatre of Blood data tracker!</p>
                <p>
                  Feel free to explore some of the recently recorded raids, or
                  search for your (or a friend&apos;s) RSN to see some player
                  stats.
                </p>
                <p>
                  If you have any questions please feel free to reach out to us
                  on our{' '}
                  <a
                    href="https://discord.gg/c5Hgv3NnYe"
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{ textDecoration: 'underline' }}
                  >
                    Discord Server
                  </a>
                  .
                </p>
              </div>
            </div>
          </CollapsiblePanel>
          <CollapsiblePanel
            panelTitle="Today's Activity"
            maxPanelHeight={2000}
            defaultExpanded
          >
            <div className={styles.activity}>
              <div className={styles.stats}>
                <Statistic
                  name="Currently Active Raids"
                  width={200}
                  height={100}
                  value={inProgressRaids}
                  maxFontSize={44}
                  simple
                />
                <Statistic
                  name="Raids Today"
                  width={200}
                  height={100}
                  value={todaysStats?.['*'].count ?? '-'}
                  maxFontSize={44}
                  simple
                />
                <Statistic
                  name="Time Raided"
                  width={200}
                  height={100}
                  maxFontSize={44}
                  value={
                    todaysStats
                      ? ticksToFormattedSeconds(todaysStats?.challengeTicks.sum)
                      : '-'
                  }
                  simple
                />
              </div>
              <div className={styles.divider} />
              <div className={styles.today}>
                <RaidCharts
                  modeData={modeData}
                  playerData={playerData}
                  scaleData={scaleData}
                  statusData={statusData}
                />
              </div>
            </div>
          </CollapsiblePanel>
        </div>
      </div>

      <div className={styles.raids}>
        <CollapsiblePanel
          panelTitle="Recently Recorded Raids"
          maxPanelHeight={4000}
          defaultExpanded
        >
          <FilteredRaidsList />
        </CollapsiblePanel>
      </div>
    </div>
  );
}

export const metadata: Metadata = {
  title: 'Theatre of Blood',
};

export const dynamic = 'force-dynamic';
