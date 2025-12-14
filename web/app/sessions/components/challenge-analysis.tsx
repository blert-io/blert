'use client';

import {
  ChallengeType,
  generalizeSplit,
  splitName,
  SplitType,
  Stage,
  stagesForChallenge,
} from '@blert/common';
import React, { useMemo, useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';

import { SessionChallenge } from '@/actions/challenge';
import Card from '@/components/card';
import Checkbox from '@/components/checkbox';
import Menu, { MenuItem } from '@/components/menu';
import RadioInput from '@/components/radio-input';
import SectionTitle from '@/components/section-title';
import Statistic from '@/components/statistic';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { challengeTerm, relevantSplitsForStage } from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';

import { useSessionContext } from './session-context-provider';

import styles from './challenge-analysis.module.scss';

enum StatType {
  SPLIT,
  CHALLENGE_SPECIFIC,
}

type StatFilter = (challenge: SessionChallenge) => boolean;

type StatOption = {
  type: StatType;
  key: string;
  label: string;
  unit?: string;
  filter?: StatFilter;
  formatter?: (value: number) => string;
};

type AggregatedData = {
  min: number;
  max: number;
  mean: number;
  median: number;
  mode: number | null;
  dataPoints: number;
  values: { challengeIndex: number; value: number; uuid: string }[];
  distribution: { value: number; count: number; percentage: number }[];
};

function getAvailableStats(
  challengeType: ChallengeType,
  challenges: SessionChallenge[],
): StatOption[] {
  const stats: StatOption[] = [];

  const allStages = stagesForChallenge(challengeType);
  const splitTypes = new Set<SplitType>();

  allStages.forEach((stage) => {
    const stageSplits = relevantSplitsForStage(stage);
    stageSplits.forEach((split) => {
      splitTypes.add(generalizeSplit(split));
    });
  });

  splitTypes.forEach((split) => {
    stats.push({
      type: StatType.SPLIT,
      key: split.toString(),
      label: splitName(split),
      unit: 'time',
      formatter: (value) => ticksToFormattedSeconds(value),
    });
  });

  if (challengeType === ChallengeType.TOB) {
    const stageFilter =
      (stage: Stage): StatFilter =>
      (challenge) =>
        challenge.stage >= stage;

    const tobStats: StatOption[] = [
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'maidenDeaths',
        label: 'Maiden Deaths',
        unit: 'count',
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'maidenFullLeaks',
        label: 'Maiden Full Leaks',
        unit: 'count',
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'bloatDeaths',
        label: 'Bloat Deaths',
        unit: 'count',
        filter: stageFilter(Stage.TOB_BLOAT),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'bloatFirstDownHpPercent',
        label: 'Bloat First Down HP %',
        unit: 'percent',
        formatter: (value) => `${value.toFixed(1)}%`,
        filter: stageFilter(Stage.TOB_BLOAT),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'nylocasDeaths',
        label: 'Nylocas Deaths',
        unit: 'count',
        filter: stageFilter(Stage.TOB_NYLOCAS),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'nylocasPreCapStalls',
        label: 'Nylocas Pre-Cap Stalls',
        unit: 'count',
        filter: stageFilter(Stage.TOB_NYLOCAS),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'nylocasPostCapStalls',
        label: 'Nylocas Post-Cap Stalls',
        unit: 'count',
        filter: stageFilter(Stage.TOB_NYLOCAS),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'nylocasMageSplits',
        label: 'Nylocas Mage Splits',
        unit: 'count',
        filter: stageFilter(Stage.TOB_NYLOCAS),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'nylocasRangedSplits',
        label: 'Nylocas Ranged Splits',
        unit: 'count',
        filter: stageFilter(Stage.TOB_NYLOCAS),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'nylocasMeleeSplits',
        label: 'Nylocas Melee Splits',
        unit: 'count',
        filter: stageFilter(Stage.TOB_SOTETSEG),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'sotetsegDeaths',
        label: 'Sotetseg Deaths',
        unit: 'count',
        filter: stageFilter(Stage.TOB_SOTETSEG),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'xarpusDeaths',
        label: 'Xarpus Deaths',
        unit: 'count',
        filter: stageFilter(Stage.TOB_XARPUS),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'xarpusHealing',
        label: 'Xarpus Healing',
        unit: 'count',
        filter: stageFilter(Stage.TOB_XARPUS),
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'verzikRedsCount',
        label: 'Verzik Reds Count',
        unit: 'count',
        filter: stageFilter(Stage.TOB_VERZIK),
      },
    ];
    stats.push(...tobStats);
  }

  if (challengeType === ChallengeType.INFERNO) {
    stats.push({
      type: StatType.CHALLENGE_SPECIFIC,
      key: 'wastPillarCollapseWave',
      label: 'Wast Pillar Collapse Wave',
      unit: 'count',
    });
    stats.push({
      type: StatType.CHALLENGE_SPECIFIC,
      key: 'eastPillarCollapseWave',
      label: 'East Pillar Collapse Wave',
      unit: 'count',
    });
    stats.push({
      type: StatType.CHALLENGE_SPECIFIC,
      key: 'southPillarCollapseWave',
      label: 'South Pillar Collapse Wave',
      unit: 'count',
    });
    stats.push({
      type: StatType.CHALLENGE_SPECIFIC,
      key: 'meleerDigs',
      label: 'Meleer Digs',
      unit: 'count',
    });
  }

  if (challengeType === ChallengeType.MOKHAIOTL) {
    const mokhaiotlStats: StatOption[] = [
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'delve',
        label: 'Delve Level',
        unit: 'count',
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'maxCompletedDelve',
        label: 'Max Completed Delve',
        unit: 'count',
      },
      {
        type: StatType.CHALLENGE_SPECIFIC,
        key: 'larvaeLeaked',
        label: 'Larvae Leaked',
        unit: 'count',
      },
    ];
    stats.push(...mokhaiotlStats);
  }

  return stats.filter((stat) => {
    return challenges.some((challenge) => {
      if (stat.type === StatType.SPLIT) {
        const generalizedSplit = parseInt(stat.key) as SplitType;
        return Object.keys(challenge.splits || {}).some((splitKey) => {
          return (
            generalizeSplit(parseInt(splitKey) as SplitType) ===
            generalizedSplit
          );
        });
      } else {
        const statsField =
          challengeType === ChallengeType.TOB
            ? 'tobStats'
            : challengeType === ChallengeType.MOKHAIOTL
              ? 'mokhaiotlStats'
              : challengeType === ChallengeType.INFERNO
                ? 'infernoStats'
                : null;
        if (!statsField) {
          return false;
        }
        const key = stat.key as keyof (typeof challenge)[typeof statsField];
        return (
          challenge[statsField]?.[key] !== undefined &&
          challenge[statsField]?.[key] !== null
        );
      }
    });
  });
}

function aggregateStatData(
  challenges: SessionChallenge[],
  selectedStat: StatOption,
  challengeType: ChallengeType,
  requireAccurateSplits: boolean = true,
): AggregatedData | null {
  const values: { challengeIndex: number; value: number; uuid: string }[] = [];

  challenges.forEach((challenge, index) => {
    let value: number | null = null;

    if (selectedStat.filter && !selectedStat.filter(challenge)) {
      return;
    }

    if (selectedStat.type === StatType.SPLIT) {
      const generalizedSplit = parseInt(selectedStat.key) as SplitType;
      const splitEntries = Object.entries(challenge.splits || {});
      for (const [splitKey, splitValue] of splitEntries) {
        if (
          generalizeSplit(parseInt(splitKey) as SplitType) === generalizedSplit
        ) {
          const typedSplitValue = splitValue as {
            ticks: number;
            accurate: boolean;
          };
          if (!requireAccurateSplits || typedSplitValue.accurate) {
            value = typedSplitValue.ticks;
            break;
          }
        }
      }
    } else {
      const statsField =
        challengeType === ChallengeType.TOB
          ? 'tobStats'
          : challengeType === ChallengeType.MOKHAIOTL
            ? 'mokhaiotlStats'
            : challengeType === ChallengeType.INFERNO
              ? 'infernoStats'
              : null;
      if (statsField) {
        const key =
          selectedStat.key as keyof (typeof challenge)[typeof statsField];
        const statValue = challenge[statsField]?.[key];
        if (statValue !== undefined && statValue !== null) {
          value = statValue;
        }
      }
    }

    if (value !== null) {
      values.push({
        challengeIndex: index + 1,
        value,
        uuid: challenge.uuid,
      });
    }
  });

  if (values.length === 0) {
    return null;
  }

  const sortedValues = [...values].sort((a, b) => a.value - b.value);
  const numericValues = values.map((v) => v.value);

  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const mean =
    numericValues.reduce((sum, val) => sum + val, 0) / numericValues.length;

  const median =
    sortedValues.length % 2 === 0
      ? (sortedValues[sortedValues.length / 2 - 1].value +
          sortedValues[sortedValues.length / 2].value) /
        2
      : sortedValues[Math.floor(sortedValues.length / 2)].value;

  const frequencyMap = new Map<number, number>();
  numericValues.forEach((val) => {
    frequencyMap.set(val, (frequencyMap.get(val) ?? 0) + 1);
  });

  let mode: number | null = null;
  let maxFrequency = 1;
  for (const [value, frequency] of frequencyMap.entries()) {
    if (frequency > maxFrequency) {
      maxFrequency = frequency;
      mode = value;
    }
  }

  // Only show mode if there are actual repeating values.
  if (maxFrequency === 1) {
    mode = null;
  }

  const distribution = Array.from(frequencyMap.entries())
    .map(([value, count]) => ({
      value,
      count,
      percentage: (count / values.length) * 100,
    }))
    .sort((a, b) => a.value - b.value);

  // Split ticks must be a whole number.
  const f: (val: number) => number =
    selectedStat.type === StatType.SPLIT
      ? (val) => Math.floor(val)
      : (val) => val;

  return {
    min: f(min),
    max: f(max),
    mean: f(mean),
    median: f(median),
    mode: mode ? f(mode) : null,
    dataPoints: values.length,
    values,
    distribution,
  };
}

function StatisticsDisplay({
  data,
  selectedStat,
}: {
  data: AggregatedData;
  selectedStat: StatOption;
}) {
  const formatter = selectedStat.formatter ?? ((value) => value.toString());

  return (
    <div className={styles.statisticsGrid}>
      <Statistic
        name="Min"
        value={formatter(data.min)}
        width={104}
        height={104}
        icon="fas fa-arrow-down"
        simple
      />
      <Statistic
        name="Max"
        value={formatter(data.max)}
        width={104}
        height={104}
        icon="fas fa-arrow-up"
        simple
      />
      <Statistic
        name="Mean"
        value={formatter(data.mean)}
        width={104}
        height={104}
        icon="fas fa-chart-line"
        simple
      />
      <Statistic
        name="Median"
        value={formatter(data.median)}
        width={104}
        height={104}
        icon="fas fa-equals"
        simple
      />
      {data.mode && (
        <Statistic
          name="Mode"
          value={formatter(data.mode)}
          width={104}
          height={104}
          icon="fas fa-repeat"
          simple
        />
      )}
      <Statistic
        name="Data Points"
        value={data.dataPoints}
        width={104}
        height={104}
        icon="fas fa-database"
        simple
      />
    </div>
  );
}

function DistributionChart({
  data,
  selectedStat,
}: {
  data: AggregatedData;
  selectedStat: StatOption;
}) {
  const formatter = selectedStat.formatter ?? ((value) => value.toString());

  if (data.distribution.length === 0) {
    return (
      <div className={styles.noDataState}>
        <i className="fas fa-chart-bar" />
        <span>No distribution data available</span>
        <p className={styles.noDataHint}>
          Distribution requires multiple data points with varying values
        </p>
      </div>
    );
  }

  const chartData = data.distribution.map((item) => ({
    value: formatter(item.value),
    originalValue: item.value,
    count: item.count,
    percentage: item.percentage,
  }));

  return (
    <div className={styles.chartContainer}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: -20 }}
        >
          <defs>
            <linearGradient
              id="distributionGradient"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#62429b" stopOpacity={0.8} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255, 255, 255, 0.1)"
          />
          <XAxis
            dataKey="value"
            tick={{ fill: 'var(--blert-text-color)', fontSize: 12 }}
            axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
            tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
            angle={selectedStat.type === StatType.SPLIT ? -45 : undefined}
            textAnchor="end"
            height={60}
            interval={0}
          />
          <YAxis
            tick={{ fill: 'var(--blert-text-color)', fontSize: 12 }}
            axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
            tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
            label={{
              value: 'Frequency',
              angle: -90,
              position: 'insideLeft',
              style: { textAnchor: 'middle', fill: 'var(--blert-text-color)' },
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--panel-bg)',
              border: '1px solid var(--nav-bg-lightened)',
              borderRadius: '6px',
              color: 'var(--blert-text-color)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            }}
            cursor={{ fill: 'rgba(139, 92, 246, 0.1)' }}
            formatter={(
              value: number,
              _name: string,
              props: { payload?: { percentage: number } },
            ) => [
              <span key={value} style={{ color: 'var(--blert-text-color)' }}>
                {value} occurrence{value === 1 ? '' : 's'}
                {/* eslint-disable-next-line react/prop-types */}
                {props.payload && ` (${props.payload.percentage.toFixed(1)}%)`}
              </span>,
            ]}
            labelFormatter={(label: string) => (
              <span style={{ fontWeight: 600, color: 'var(--font-color-nav)' }}>
                Value: {label}
              </span>
            )}
          />
          <Bar
            dataKey="count"
            fill="url(#distributionGradient)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

enum ChartType {
  BAR,
  LINE,
}

function ChartDisplay({
  data,
  selectedStat,
  chartType,
  challengeType,
}: {
  data: AggregatedData;
  selectedStat: StatOption;
  chartType: ChartType;
  challengeType: ChallengeType;
}) {
  const chartData = data.values.map((point) => ({
    challengeIndex: point.challengeIndex,
    value: point.value,
    formatter: selectedStat.formatter,
  }));

  const tooltip = (
    <Tooltip
      contentStyle={{
        backgroundColor: 'var(--panel-bg)',
        border: '1px solid var(--nav-bg-lightened)',
        borderRadius: '6px',
        color: 'var(--blert-text-color)',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      }}
      cursor={{ fill: 'rgba(139, 92, 246, 0.1)' }}
      formatter={(value: number, _name: string, _props: any) => [
        <span key={value} style={{ color: 'var(--blert-text-color)' }}>
          {selectedStat.formatter ? selectedStat.formatter(value) : value}
        </span>,
      ]}
      labelFormatter={(label: string) => (
        <span style={{ fontWeight: 600, color: 'var(--font-color-nav)' }}>
          {challengeTerm(challengeType)} #{label}
        </span>
      )}
    />
  );

  return (
    <div className={styles.chartContainer}>
      <ResponsiveContainer width="100%" height={300}>
        {chartType === ChartType.BAR ? (
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
          >
            <defs>
              <linearGradient
                id="progressionGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#62429b" stopOpacity={0.8} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255, 255, 255, 0.1)"
            />
            <XAxis
              dataKey="challengeIndex"
              tick={{ fill: 'var(--blert-text-color)', fontSize: 12 }}
              axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
              tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
              tickFormatter={(value: number) => `#${value}`}
            />
            <YAxis
              tick={{ fill: 'var(--blert-text-color)', fontSize: 12 }}
              axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
              tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
              tickFormatter={selectedStat.formatter}
            />
            {tooltip}
            <Bar
              dataKey="value"
              fill="url(#progressionGradient)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        ) : (
          <LineChart
            data={chartData}
            margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255, 255, 255, 0.1)"
            />
            <XAxis
              dataKey="challengeIndex"
              tick={{ fill: 'var(--blert-text-color)', fontSize: 12 }}
              axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
              tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
              tickFormatter={(value: number) => `#${value}`}
            />
            <YAxis
              tick={{ fill: 'var(--blert-text-color)', fontSize: 12 }}
              axisLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
              tickLine={{ stroke: 'rgba(255, 255, 255, 0.2)' }}
              tickFormatter={selectedStat.formatter}
            />
            {tooltip}
            <Line
              type="monotone"
              dataKey="value"
              stroke="#8b5cf6"
              strokeWidth={3}
              dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 4 }}
              activeDot={{
                r: 6,
                stroke: '#8b5cf6',
                strokeWidth: 2,
                fill: '#a855f7',
              }}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export default function ChallengeAnalysis() {
  const { session, isInitialLoad } = useSessionContext();
  const [selectedStatKey, setSelectedStatKey] = useState<string | null>(null);
  const [chartType, setChartType] = useState<ChartType>(ChartType.LINE);
  const [requireAccurateSplits, setRequireAccurateSplits] = useState(true);
  const [statMenuOpen, setStatMenuOpen] = useState(false);

  const term = challengeTerm(session?.challengeType ?? ChallengeType.TOB);

  const availableStats = useMemo(() => {
    if (!session) {
      return [];
    }

    return getAvailableStats(session.challengeType, session.challenges);
  }, [session]);

  const selectedStat = useMemo(() => {
    if (!selectedStatKey) {
      return null;
    }

    return (
      availableStats.find(
        (stat) => `${stat.type}-${stat.key}` === selectedStatKey,
      ) ?? null
    );
  }, [selectedStatKey, availableStats]);

  const menuItems = useMemo(() => {
    const splitStats = availableStats.filter(
      (stat) => stat.type === StatType.SPLIT,
    );
    const challengeStats = availableStats.filter(
      (stat) => stat.type === StatType.CHALLENGE_SPECIFIC,
    );

    const items: MenuItem[] = [];

    if (splitStats.length > 0) {
      items.push({
        label: 'Split Times',
        subMenu: splitStats.map((stat) => ({
          label: stat.label,
          value: `${stat.type}-${stat.key}`,
        })),
      });
    }

    if (challengeStats.length > 0) {
      items.push({
        label: `${term} Stats`,
        subMenu: challengeStats.map((stat) => ({
          label: stat.label,
          value: `${stat.type}-${stat.key}`,
        })),
      });
    }

    return items;
  }, [availableStats, term]);

  // Store last selected statKey for each group
  const [groupStatKeys, setGroupStatKeys] = useState<Record<number, string>>(
    {},
  );

  // Derive selectedGroupIdx from selectedStatKey and menuItems
  const selectedGroupIdx = useMemo(() => {
    if (!selectedStatKey || menuItems.length === 0) {
      return 0;
    }
    const idx = menuItems.findIndex((group) =>
      group.subMenu?.some((item) => item.value === selectedStatKey),
    );
    return idx === -1 ? 0 : idx;
  }, [selectedStatKey, menuItems]);

  // When group changes, restore last stat for that group or default to first
  useEffect(() => {
    if (menuItems.length > 0) {
      const group = menuItems[selectedGroupIdx];
      const statKey =
        groupStatKeys[selectedGroupIdx] ?? group.subMenu?.[0]?.value;
      if (statKey && statKey !== selectedStatKey) {
        setSelectedStatKey(statKey);
      }
    }
  }, [selectedGroupIdx, menuItems, groupStatKeys, selectedStatKey]);

  const aggregatedData = useMemo(() => {
    if (!session || !selectedStat) {
      return null;
    }

    return aggregateStatData(
      session.challenges,
      selectedStat,
      session.challengeType,
      requireAccurateSplits,
    );
  }, [session, selectedStat, requireAccurateSplits]);

  if (isInitialLoad) {
    return (
      <Card>
        <SectionTitle icon="fa-chart-line">Analytics</SectionTitle>
        <div className={styles.skeleton} />
      </Card>
    );
  }

  if (!session) {
    return (
      <Card>
        <SectionTitle icon="fa-chart-line">Analytics</SectionTitle>
        <div className={styles.errorState}>
          <i className="fas fa-exclamation-triangle" />
          <span>Failed to load session data</span>
        </div>
      </Card>
    );
  }

  if (availableStats.length === 0) {
    return (
      <Card>
        <SectionTitle icon="fa-chart-line">Analytics</SectionTitle>
        <div className={styles.emptyState}>
          <i className="fas fa-chart-bar" />
          <span>No comparable statistics available</span>
          <p className={styles.emptyHint}>
            Complete more challenges to unlock statistical analysis
          </p>
        </div>
      </Card>
    );
  }

  // Auto-select the first stat if none is selected.
  if (!selectedStatKey && availableStats.length > 0) {
    setSelectedStatKey(`${availableStats[0].type}-${availableStats[0].key}`);
  }

  return (
    <Card fixed>
      <SectionTitle icon="fa-chart-line">Analytics</SectionTitle>

      <div className={styles.controls}>
        <div className={styles.statSelector}>
          <label className={styles.selectorLabel}>
            <i className="fas fa-chart-bar" />
            Select Statistic:
          </label>
          <p className={styles.selectorDescription}>
            Choose any split time or challenge-specific statistic to analyze
            across all challenges in the session.
          </p>
          {menuItems.length > 1 ? (
            <div className={styles.statGroupSelector}>
              <RadioInput.Group
                name="stat-group"
                compact
                joined
                onChange={(idx) => {
                  // Only update selectedStatKey; useEffect will restore last stat for group
                  setSelectedStatKey(
                    groupStatKeys[Number(idx)] ??
                      menuItems[Number(idx)]?.subMenu?.[0]?.value ??
                      null,
                  );
                }}
              >
                {menuItems.map((group, idx) => (
                  <RadioInput.Option
                    key={group.label}
                    id={`stat-group-${idx}`}
                    label={group.label}
                    value={idx}
                    checked={selectedGroupIdx === idx}
                  />
                ))}
              </RadioInput.Group>
            </div>
          ) : null}
          {/* Second tier: dropdown or menu for stats in the selected group */}
          {menuItems.length > 0 && (
            <>
              <button
                id="stat-select"
                className={styles.selectButton}
                onClick={() => setStatMenuOpen(true)}
                aria-expanded={statMenuOpen}
                aria-haspopup="menu"
              >
                {selectedStat
                  ? (menuItems[selectedGroupIdx]?.subMenu?.find(
                      (item) => item.value === selectedStatKey,
                    )?.label ?? 'Choose a statistic...')
                  : 'Choose a statistic...'}
                <i className="fas fa-chevron-down" />
              </button>
              <Menu
                onClose={() => setStatMenuOpen(false)}
                onSelection={(value) => {
                  setSelectedStatKey(value as string);
                  setGroupStatKeys((prev) => ({
                    ...prev,
                    [selectedGroupIdx]: value as string,
                  }));
                  setStatMenuOpen(false);
                }}
                open={statMenuOpen}
                items={
                  menuItems[selectedGroupIdx]?.subMenu?.map((item) => ({
                    ...item,
                  })) ?? []
                }
                targetId="stat-select"
              />
            </>
          )}
        </div>

        {selectedStat && aggregatedData && (
          <div className={styles.chartTypeSelector}>
            <span className={styles.selectorLabel}>
              Progression Chart Type:
            </span>
            <RadioInput.Group
              name="chart-type"
              compact
              joined
              onChange={(value) => setChartType(value as ChartType)}
            >
              <RadioInput.Option
                checked={chartType === ChartType.LINE}
                id="chart-type-line"
                label="Line"
                value={ChartType.LINE}
              />
              <RadioInput.Option
                checked={chartType === ChartType.BAR}
                id="chart-type-bar"
                label="Bar"
                value={ChartType.BAR}
              />
            </RadioInput.Group>
          </div>
        )}

        <div className={styles.accuracySelector}>
          <Checkbox
            checked={requireAccurateSplits}
            onChange={setRequireAccurateSplits}
            label="Require accurate timing data"
            simple
          />
          <p className={styles.accuracyDescription}>
            When enabled, only includes splits with accurate timing
            measurements. Disable to see all available data including estimated
            timings.
          </p>
        </div>
      </div>

      {selectedStat && aggregatedData && (
        <>
          <div className={styles.analyticsSection}>
            <h3 className={styles.sectionTitle}>
              <i className="fas fa-calculator" />
              Statistical Summary
            </h3>
            <StatisticsDisplay
              data={aggregatedData}
              selectedStat={selectedStat}
            />
          </div>

          <div className={styles.chartsContainer}>
            <div className={styles.chartSection}>
              <div className={styles.analyticsSection}>
                <h3 className={styles.sectionTitle}>
                  <i className="fas fa-chart-area" />
                  Progression Chart
                  <span
                    className={styles.infoIcon}
                    data-tooltip-id={GLOBAL_TOOLTIP_ID}
                    data-tooltip-content="Shows the selected statistic value for each challenge in chronological order"
                  >
                    <i className="fas fa-info-circle" />
                  </span>
                </h3>
                <ChartDisplay
                  data={aggregatedData}
                  selectedStat={selectedStat}
                  chartType={chartType}
                  challengeType={session.challengeType}
                />
              </div>
            </div>

            <div className={styles.chartSection}>
              <div className={styles.analyticsSection}>
                <h3 className={styles.sectionTitle}>
                  <i className="fas fa-table" />
                  Value Distribution
                  <span
                    className={styles.infoIcon}
                    data-tooltip-id={GLOBAL_TOOLTIP_ID}
                    data-tooltip-content="Shows how frequently each value occurs across all challenges in the session"
                  >
                    <i className="fas fa-info-circle" />
                  </span>
                </h3>
                <DistributionChart
                  data={aggregatedData}
                  selectedStat={selectedStat}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {selectedStat && !aggregatedData && (
        <div className={styles.noDataState}>
          <i className="fas fa-chart-line" />
          <span>No data available for &ldquo;{selectedStat.label}&rdquo;</span>
          <p className={styles.noDataHint}>
            This statistic requires challenges with valid data. Try adjusting
            the accuracy requirement if no data is available.
          </p>
        </div>
      )}
    </Card>
  );
}
