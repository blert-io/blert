'use client';

import { ChallengeType, Stage } from '@blert/common';
import { useContext, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

import { ChallengeStats, getTotalDeathsByStage } from '../actions/challenge';
import CollapsiblePanel from '../components/collapsible-panel';
import Statistic from '../components/statistic';

import styles from './style.module.scss';
import { DisplayContext } from '../display';

function stageName(stage: Stage): string {
  switch (stage) {
    case Stage.TOB_MAIDEN:
      return 'Maiden';
    case Stage.TOB_BLOAT:
      return 'Bloat';
    case Stage.TOB_NYLOCAS:
      return 'Nylocas';
    case Stage.TOB_SOTETSEG:
      return 'Sotetseg';
    case Stage.TOB_XARPUS:
      return 'Xarpus';
    case Stage.TOB_VERZIK:
      return 'Verzik';
  }

  return 'Unknown';
}

const STATISTIC_SIZE = 104;

export default function TrendsPage() {
  const display = useContext(DisplayContext);

  const [deathsByTobRoom, setDeathsByTobRoom] = useState<{
    [key: number]: number;
  }>({});

  const [raidStats, setRaidStats] = useState<ChallengeStats | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      const fetches = [
        getTotalDeathsByStage([
          Stage.TOB_MAIDEN,
          Stage.TOB_BLOAT,
          Stage.TOB_NYLOCAS,
          Stage.TOB_SOTETSEG,
          Stage.TOB_XARPUS,
          Stage.TOB_VERZIK,
        ]).then(setDeathsByTobRoom),
        fetch(`/api/v1/challenges/stats?type=${ChallengeType.TOB}`)
          .then((res) => res.json())
          .then(setRaidStats),
      ];

      await Promise.all(fetches);
    };

    fetchData();
  }, []);

  const tobDeathData = Object.entries(deathsByTobRoom).map(
    ([stage, deaths]) => ({
      name: stageName(Number(stage)),
      deaths,
    }),
  );

  const chartWidth = display.isFull() ? 600 : 350;

  return (
    <div className={styles.trends}>
      <h1>Trends</h1>

      <CollapsiblePanel
        panelTitle="Theatre of Blood"
        defaultExpanded
        maxPanelHeight={1000}
      >
        <div className={styles.challengeStats}>
          {(raidStats !== null && (
            <>
              <Statistic
                name="Total Raids"
                value={raidStats.total}
                height={STATISTIC_SIZE}
                width={STATISTIC_SIZE}
              />
              <Statistic
                name="Completions"
                value={raidStats.completions}
                height={STATISTIC_SIZE}
                width={STATISTIC_SIZE}
              />
              <Statistic
                name="Resets"
                value={raidStats.resets}
                height={STATISTIC_SIZE}
                width={STATISTIC_SIZE}
              />
              <Statistic
                name="Wipes"
                value={raidStats.wipes}
                height={STATISTIC_SIZE}
                width={STATISTIC_SIZE}
              />
            </>
          )) || (
            <div
              className={styles.statsLoading}
              style={{ height: STATISTIC_SIZE }}
            >
              Loading...
            </div>
          )}
        </div>
        <div
          className={styles.charts}
          style={{ padding: display.isFull() ? `0 ${20}px` : 0 }}
        >
          <h2>Deaths by Room</h2>
          <BarChart
            data={tobDeathData}
            width={chartWidth}
            height={chartWidth / 2}
          >
            <CartesianGrid strokeDasharray="2 2" />
            <Bar dataKey="deaths" fill="#62429b" />
            <XAxis
              dataKey="name"
              tick={{
                fill: 'var(--blert-text-color)',
                fontSize: display.isCompact() ? 11 : 16,
              }}
              interval={0}
            />
            <YAxis tick={{ fill: 'var(--blert-text-color)' }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#171821', color: '#fff' }}
              cursor={false}
              labelFormatter={(room: string) => <strong>{room}</strong>}
              formatter={(value: number) => [
                <span style={{ color: 'var(--blert-text-color)' }}>
                  {value} deaths
                </span>,
              ]}
              position={{ y: 100 }}
            />
          </BarChart>
        </div>
      </CollapsiblePanel>
    </div>
  );
}
