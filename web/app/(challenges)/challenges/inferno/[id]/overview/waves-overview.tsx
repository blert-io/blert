import {
  ChallengeType,
  InfernoChallenge,
  SplitType,
  Stage,
} from '@blert/common';
import Link from 'next/link';
import Image from 'next/image';
import { useMemo } from 'react';

import Card from '@/components/card';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import styles from './style.module.scss';

type WaveGroup = {
  title: string;
  startWave: number;
  endWave: number;
  startSplit: SplitType | null;
  special?: boolean;
  imageUrl?: string;
};

const WAVE_GROUPS: WaveGroup[] = [
  {
    title: 'Waves 1-8',
    startWave: 1,
    endWave: 8,
    startSplit: null,
  },
  {
    title: 'Waves 9-17',
    startWave: 9,
    endWave: 17,
    startSplit: SplitType.INFERNO_WAVE_9_START,
  },
  {
    title: 'Waves 18-24',
    startWave: 18,
    endWave: 24,
    startSplit: SplitType.INFERNO_WAVE_18_START,
  },
  {
    title: 'Waves 25-34',
    startWave: 25,
    endWave: 34,
    startSplit: SplitType.INFERNO_WAVE_25_START,
  },
  {
    title: 'Waves 35-41',
    startWave: 35,
    endWave: 41,
    startSplit: SplitType.INFERNO_WAVE_35_START,
  },
  {
    title: 'Waves 42-49',
    startWave: 42,
    endWave: 49,
    startSplit: SplitType.INFERNO_WAVE_42_START,
  },
  {
    title: 'Waves 50-56',
    startWave: 50,
    endWave: 56,
    startSplit: SplitType.INFERNO_WAVE_50_START,
  },
  {
    title: 'Waves 57-59',
    startWave: 57,
    endWave: 59,
    startSplit: SplitType.INFERNO_WAVE_57_START,
  },
  {
    title: 'Waves 60-62',
    startWave: 60,
    endWave: 62,
    startSplit: SplitType.INFERNO_WAVE_60_START,
  },
  {
    title: 'Waves 63-65',
    startWave: 63,
    endWave: 65,
    startSplit: SplitType.INFERNO_WAVE_63_START,
  },
  {
    title: 'Wave 66',
    startWave: 66,
    endWave: 66,
    startSplit: SplitType.INFERNO_WAVE_66_START,
  },
  {
    title: 'Jad',
    startWave: 67,
    endWave: 67,
    startSplit: SplitType.INFERNO_WAVE_67_START,
    special: true,
    imageUrl: '/images/npcs/7700.webp',
  },
  {
    title: 'Triples',
    startWave: 68,
    endWave: 68,
    startSplit: SplitType.INFERNO_WAVE_68_START,
    special: true,
    imageUrl: '/images/npcs/7700.webp',
  },
  {
    title: 'Zuk',
    startWave: 69,
    endWave: 69,
    startSplit: SplitType.INFERNO_WAVE_69_START,
    special: true,
    imageUrl: '/images/npcs/7706.webp',
  },
];

interface WaveGroupOverviewProps {
  group: WaveGroup;
  challengeId: string;
  startTick: number | null;
  duration: number | null;
  reachedWaves: Set<number>;
}

function WaveGroupOverview({
  group,
  challengeId,
  startTick,
  duration,
  reachedWaves,
}: WaveGroupOverviewProps) {
  const waveNumbers = Array.from(
    { length: group.endWave - group.startWave + 1 },
    (_, i) => group.startWave + i,
  ).filter((waveNum) => reachedWaves.has(waveNum));

  return (
    <Card
      className={`${styles.waveGroup} ${group.special ? styles.special : ''}`}
      primary={group.special}
    >
      <div className={styles.groupHeader}>
        <div className={styles.groupInfo}>
          <div className={styles.groupTitle}>
            {group.imageUrl && (
              <div className={styles.bossImage}>
                <Image
                  src={group.imageUrl}
                  alt={group.title}
                  width={48}
                  height={48}
                />
              </div>
            )}
            <span>{group.title}</span>
          </div>
          <div className={styles.groupTiming}>
            {startTick !== null && (
              <div className={styles.startTime}>
                <i className="fas fa-clock" />
                {ticksToFormattedSeconds(startTick)}
              </div>
            )}
            {duration !== null && (
              <div className={styles.duration}>
                <i className="fas fa-hourglass" />
                {ticksToFormattedSeconds(duration)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.waveLinks}>
        {waveNumbers.map((num) => {
          return (
            <Link
              key={num}
              href={`${challengeUrl(ChallengeType.INFERNO, challengeId)}/waves/${num}`}
              className={styles.waveLink}
            >
              {num}
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

export function InfernoWavesOverview({
  challenge,
}: {
  challenge: InfernoChallenge;
}) {
  const waves = challenge.inferno.waves;

  const [reachedWaves, reachableGroups] = useMemo(() => {
    const reachedWaves = new Set(
      waves.map((wave) => wave.stage - Stage.INFERNO_WAVE_1 + 1),
    );

    // Filter groups to only include those with at least one reached wave.
    const reachableGroups = WAVE_GROUPS.filter((group) =>
      Array.from(
        { length: group.endWave - group.startWave + 1 },
        (_, i) => group.startWave + i,
      ).some((waveNum) => reachedWaves.has(waveNum)),
    );

    return [reachedWaves, reachableGroups];
  }, [waves]);

  const getGroupStartTick = (group: WaveGroup): number | null => {
    if (group.startSplit === null) {
      return 0;
    }
    return challenge.splits[group.startSplit] ?? null;
  };

  const getGroupDuration = (
    group: WaveGroup,
    nextGroup?: WaveGroup,
  ): number | null => {
    const startTick = getGroupStartTick(group);
    if (startTick === null) {
      return null;
    }

    let endTick: number | null = null;
    if (nextGroup !== undefined) {
      endTick = getGroupStartTick(nextGroup);
    } else {
      // For the last group, use challenge completion time or current progress.
      endTick = challenge.challengeTicks;
    }

    if (endTick === null) {
      return null;
    }
    return endTick - startTick;
  };

  return (
    <div className={styles.wavesOverview}>
      <h2>Wave Progress</h2>
      <div className={styles.groups}>
        {reachableGroups.map((group, index) => {
          const nextGroup = reachableGroups[index + 1];
          const startTick = getGroupStartTick(group);
          const duration = getGroupDuration(group, nextGroup);

          return (
            <WaveGroupOverview
              key={group.title}
              group={group}
              challengeId={challenge.uuid}
              startTick={startTick}
              duration={duration}
              reachedWaves={reachedWaves}
            />
          );
        })}
      </div>
    </div>
  );
}
