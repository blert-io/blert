'use client';

import { PlayerStats } from '@blert/common';
import { useState, useEffect } from 'react';
import {
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';

import Card from '@/components/card';
import Menu, { MenuItem } from '@/components/menu';
import Statistic from '@/components/statistic';
import { useClientOnly } from '@/hooks/client-only';

import BgsIcon from '@/svg/bandos-godsword.svg';
import ChallyIcon from '@/svg/chally.svg';
import ChinchompaIcon from '@/svg/chinchompa.svg';
import ElderMaulIcon from '@/svg/elder-maul.svg';
import MaidenIcon from '@/svg/maiden.svg';
import RalosIcon from '@/svg/ralos.svg';
import ScytheIcon from '@/svg/scythe.svg';
import VerzikIcon from '@/svg/verzik.svg';

import { PLAYER_PAGE_STATISTIC_SIZE } from '../dimensions';
import { usePlayer } from '../player-context';

import styles from '../style.module.scss';

type ViewableStatistic = {
  key: keyof PlayerStats;
  name: string;
};

const AVAILABLE_STATS: ViewableStatistic[] = [
  { key: 'tobCompletions', name: 'ToB Completions' },
  { key: 'tobWipes', name: 'ToB Wipes' },
  { key: 'tobResets', name: 'ToB Resets' },
  { key: 'bgsSmacks', name: 'BGS Smacks' },
  { key: 'hammerBops', name: 'Hammer Bops' },
  { key: 'elderMaulSmacks', name: 'Maul Bonks' },
  { key: 'challyPokes', name: 'Chally Pokes' },
  { key: 'ralosAutos', name: 'Ralos Autos' },
  { key: 'unchargedScytheSwings', name: 'Uncharged Scythes' },
  { key: 'tobBarragesWithoutProperWeapon', name: 'Barrages w/o 15% weapon' },
  { key: 'tobVerzikP1TrollSpecs', name: 'Non-Dawn P1 Specs' },
  { key: 'tobVerzikP3Melees', name: 'P3 Melees' },
];

const DEFAULT_SELECTED_STATS: ViewableStatistic[] = [
  { key: 'tobCompletions', name: 'ToB Completions' },
  { key: 'tobWipes', name: 'ToB Wipes' },
  { key: 'tobResets', name: 'ToB Resets' },
];

const STAT_COLORS = [
  '#4aba91',
  '#e85d6f',
  '#d4b95e',
  '#5b9bd5',
  '#8c7bb0',
  '#45a5a1',
];
const MAX_SELECTED_STATS = STAT_COLORS.length;

export default function PlayerStatistics() {
  const isClient = useClientOnly();
  const player = usePlayer();
  const stats = player.stats;

  const [selectedStats, setSelectedStats] = useState<ViewableStatistic[]>(
    DEFAULT_SELECTED_STATS,
  );
  const [historicalData, setHistoricalData] = useState<any[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const fetchHistoricalData = async () => {
      try {
        const fields = selectedStats.map((stat) => stat.key).join(',');
        const response = await fetch(
          `/api/v1/players/${player.username}/stats?which=${fields}`,
        );
        if (!response.ok) {
          throw new Error('Failed to fetch historical data');
        }
        const data = await response.json();
        setHistoricalData(data.reverse());
      } catch (error) {
        console.error('Error fetching historical data:', error);
      }
    };

    fetchHistoricalData();
  }, [player.username, selectedStats]);

  const menuItems: MenuItem[] = AVAILABLE_STATS.map((stat) => ({
    label: stat.name,
    value: stat.key,
    icon: selectedStats.find((s) => s.key === stat.key) ? 'fas fa-check' : '',
  }));

  const handleStatSelection = (value: string | number) => {
    const stat = AVAILABLE_STATS.find((s) => s.key === value);
    if (stat) {
      setSelectedStats((prev) => {
        if (prev.find((s) => s.key === stat.key)) {
          return prev.filter((s) => s.key !== stat.key);
        }
        return [...prev.slice(0, 5), stat];
      });
    }
  };

  const removeStatFromSelection = (statKey: string) => {
    setSelectedStats(selectedStats.filter((s) => s.key !== statKey));
  };

  const chinsThrownIncorrectlyPercentage =
    stats.chinsThrownMaiden > 0
      ? (stats.chinsThrownIncorrectlyMaiden / stats.chinsThrownMaiden) * 100
      : 0;

  const deathsByRoom = [
    { name: 'Maiden', count: stats.deathsMaiden, color: '#e63946' },
    { name: 'Bloat', count: stats.deathsBloat, color: '#b8a46c' },
    { name: 'Nylocas', count: stats.deathsNylocas, color: '#a8a8a8' },
    { name: 'Sotetseg', count: stats.deathsSotetseg, color: '#b22222' },
    { name: 'Xarpus', count: stats.deathsXarpus, color: '#5d5da1' },
    { name: 'Verzik', count: stats.deathsVerzik, color: '#7d3c98' },
  ];

  return (
    <div className={styles.statistics}>
      <div className={styles.statisticsGrid}>
        <Card
          className={styles.statsCard}
          header={{
            title: (
              <div className={styles.headerContent}>
                <i className="fas fa-skull" />
                Deaths by Room
              </div>
            ),
          }}
        >
          {isClient ? (
            <PieChart width={360} height={360}>
              <Pie
                data={deathsByRoom}
                dataKey="count"
                cx="50%"
                cy="50%"
                outerRadius="80%"
                innerRadius="50%"
                stroke="#1b1c25"
              >
                {deathsByRoom.map((v, i) => (
                  <Cell key={`cell-${i}`} fill={v.color} />
                ))}
              </Pie>
              <Legend
                verticalAlign="bottom"
                height={36}
                formatter={(value) => {
                  const item = deathsByRoom.find((s) => s.name === value);
                  return (
                    <span className={styles.legendItem}>
                      {value} ({item?.count})
                    </span>
                  );
                }}
              />
            </PieChart>
          ) : (
            <div style={{ width: 360, height: 360 }} />
          )}
        </Card>

        <Card
          className={styles.statsCard}
          header={{
            title: (
              <div className={styles.headerContent}>
                <i className="fas fa-chart-line" />
                Historic Stats
                <span className={styles.statCounter}>
                  {selectedStats.length}/{MAX_SELECTED_STATS} stats
                </span>
                <button
                  id="stats-chart-add"
                  className={`${styles.addStatButton} ${selectedStats.length >= MAX_SELECTED_STATS ? styles.disabled : ''}`}
                  onClick={() =>
                    selectedStats.length < MAX_SELECTED_STATS &&
                    setMenuOpen(true)
                  }
                  title={
                    selectedStats.length >= MAX_SELECTED_STATS
                      ? `Maximum of ${MAX_SELECTED_STATS} stats reached`
                      : 'Add statistic'
                  }
                  disabled={selectedStats.length >= MAX_SELECTED_STATS}
                >
                  <i className="fas fa-plus" />
                </button>
              </div>
            ),
          }}
        >
          {isClient && historicalData.length > 0 ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <LineChart data={historicalData} margin={{ right: 40 }}>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(date) =>
                      new Date(date).toLocaleDateString()
                    }
                    stroke="var(--font-color-nav)"
                    dy={5}
                  />
                  <YAxis stroke="var(--font-color-nav)" />
                  {selectedStats.map((stat, index) => (
                    <Line
                      key={stat.key}
                      type="monotone"
                      dataKey={stat.key}
                      stroke={STAT_COLORS[index]}
                      dot={false}
                    />
                  ))}
                  <Tooltip
                    cursor={false}
                    contentStyle={{
                      backgroundColor: 'var(--nav-bg)',
                      borderColor: 'var(--font-color-nav-divider)',
                      borderRadius: '4px',
                    }}
                    labelFormatter={(date) => (
                      <span
                        style={{
                          display: 'block',
                          color: 'var(--blert-text-color)',
                          fontWeight: 500,
                          marginBottom: 8,
                        }}
                      >
                        {new Date(date).toLocaleDateString()}
                      </span>
                    )}
                    formatter={(value: number, name: string) => {
                      const fullName = selectedStats.find(
                        (s) => s.key === name,
                      )?.name;
                      return [value, fullName ?? name];
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ width: '100%', height: 300 }} />
          )}
          <div className={styles.selectedStats}>
            {selectedStats.map((stat, index) => (
              <button
                key={stat.key}
                className={styles.selectedStat}
                style={{ color: STAT_COLORS[index] }}
                onClick={() => removeStatFromSelection(stat.key)}
              >
                {stat.name}
                <i className="fas fa-times" />
              </button>
            ))}
          </div>
          <Menu
            targetId="stats-chart-add"
            items={menuItems}
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            onSelection={handleStatSelection}
            width={300}
          />
        </Card>

        <Card
          className={`${styles.statsCard} ${styles.fullWidth}`}
          header={{
            title: (
              <div className={styles.headerContent}>
                <i className="fas fa-face-grin-tears" />
                Theatre of Blood Trolls
              </div>
            ),
          }}
        >
          <div className={styles.statsGrid}>
            <Statistic
              name="BGS Smacks"
              value={stats.bgsSmacks}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              icon={<BgsIcon width={24} height={24} />}
            />
            {stats.hammerBops > stats.elderMaulSmacks ? (
              <Statistic
                name="Hammer Bops"
                value={stats.hammerBops}
                height={PLAYER_PAGE_STATISTIC_SIZE}
                icon="fas fa-hammer"
              />
            ) : (
              <Statistic
                name="Maul Bonks"
                value={stats.elderMaulSmacks}
                height={PLAYER_PAGE_STATISTIC_SIZE}
                icon={<ElderMaulIcon width={24} height={24} />}
              />
            )}
            <Statistic
              name="Chally Pokes"
              value={stats.challyPokes}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              icon={<ChallyIcon width={24} height={24} />}
            />
            <Statistic
              name="Ralos Autos"
              value={stats.ralosAutos}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              icon={<RalosIcon width={24} height={24} />}
            />
            <Statistic
              name="Uncharged Scythes"
              value={stats.unchargedScytheSwings}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              icon={<ScytheIcon width={24} height={24} />}
            />
            <Statistic
              name="Barrages w/o 15% weapon"
              value={stats.tobBarragesWithoutProperWeapon}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              icon="fas fa-wand-sparkles"
            />
            <Statistic
              name="Non-Dawn P1 Specs"
              value={stats.tobVerzikP1TrollSpecs}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              icon="fas fa-bolt"
            />
            <Statistic
              name="P3 Melees"
              value={stats.tobVerzikP3Melees}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              icon={<VerzikIcon width={24} height={24} />}
            />
          </div>
        </Card>

        <Card
          className={`${styles.statsCard} ${styles.fullWidth}`}
          header={{
            title: (
              <div className={styles.headerContent}>
                <i className="fas fa-bomb" />
                Chinchompa Stats
              </div>
            ),
          }}
        >
          <div className={styles.statsGrid}>
            <Statistic
              name="Chins Thrown"
              value={stats.chinsThrownTotal}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              icon={<ChinchompaIcon width={24} height={24} />}
            />
            <Statistic
              name="During Maiden"
              value={stats.chinsThrownMaiden}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              icon={<MaidenIcon width={24} height={24} />}
            />
            <Statistic
              name="Wrong Distance"
              value={stats.chinsThrownIncorrectlyMaiden}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              icon="fas fa-triangle-exclamation"
              tooltip="Chinchompas on medium fuse must be thrown from a distance of 4-6 tiles to be 100% accurate."
            />
            <Statistic
              name="Troll Chins %"
              value={chinsThrownIncorrectlyPercentage.toFixed(1)}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              unit="%"
              icon="fas fa-percent"
              tooltip="Percentage of chins thrown during Maiden which were thrown from the wrong distance."
            />
            <Statistic
              name="Thrown Value"
              value={stats.chinsThrownValue}
              height={PLAYER_PAGE_STATISTIC_SIZE}
              unit="gp"
              icon="fas fa-coins"
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
