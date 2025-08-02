'use client';

import {
  adjustSplitForMode,
  ChallengeMode,
  challengeName,
  ChallengeType,
  SplitType,
} from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useContext, useEffect, useState } from 'react';

import { PersonalBest } from '@/actions/challenge';
import { Card } from '@/components/card/card';
import RadioInput from '@/components/radio-input';
import { DisplayContext } from '@/display';
import { challengeLogo } from '@/logo';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl, queryString } from '@/utils/url';

import { usePlayer } from '../player-context';

import styles from './style.module.scss';

import BloatIcon from '@/svg/bloat.svg';
import MaidenIcon from '@/svg/maiden.svg';
import NylocasIcon from '@/svg/nyloking.svg';
import SotetsegIcon from '@/svg/sotetseg.svg';
import XarpusIcon from '@/svg/xarpus.svg';
import VerzikIcon from '@/svg/verzik.svg';

type Scale = 1 | 2 | 3 | 4 | 5;

type SplitMetadata = {
  type: SplitType;
  name: string;
  description: string;
  icon: string | React.ReactNode;
  fullWidth?: boolean;
};

type Achievement = {
  name: string;
  value: string | number;
  icon: string;
  date?: Date;
  challengeType: ChallengeType;
  challengeId: string;
};

const TOB_SPLIT_TYPES: SplitMetadata[] = [
  {
    type: SplitType.TOB_CHALLENGE,
    name: 'Challenge Time',
    description: 'Best challenge (in-room) completion time',
    icon: 'fas fa-flag-checkered',
    fullWidth: true,
  },
  {
    type: SplitType.TOB_OVERALL,
    name: 'Overall Time',
    description: 'Best overall (real time) raid completion time',
    icon: 'fas fa-clock',
    fullWidth: true,
  },
  {
    type: SplitType.TOB_MAIDEN,
    name: 'Maiden',
    description: 'Best Maiden room completion time',
    icon: <MaidenIcon width={28} height={28} style={{ left: 1 }} />,
  },
  {
    type: SplitType.TOB_BLOAT,
    name: 'Bloat',
    description: 'Best Bloat room completion time',
    icon: <BloatIcon width={28} height={28} />,
  },
  {
    type: SplitType.TOB_NYLO_ROOM,
    name: 'Nylocas',
    description: 'Best Nylocas room completion time',
    icon: <NylocasIcon width={28} height={28} />,
  },
  {
    type: SplitType.TOB_NYLO_BOSS_SPAWN,
    name: 'Nylocas Boss Spawn',
    description: 'Best time from start of Nylocas to boss spawn',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.TOB_NYLO_BOSS,
    name: 'Nylocas Boss Time',
    description: 'Best Nylocas boss kill time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.TOB_SOTETSEG,
    name: 'Sotetseg',
    description: 'Best Sotetseg room completion time',
    icon: <SotetsegIcon width={28} height={28} />,
  },
  {
    type: SplitType.TOB_XARPUS,
    name: 'Xarpus',
    description: 'Best Xarpus room completion time',
    icon: <XarpusIcon width={28} height={28} style={{ left: 2 }} />,
  },
  {
    type: SplitType.TOB_VERZIK_ROOM,
    name: 'Verzik',
    description: 'Best Verzik room completion time',
    icon: <VerzikIcon width={28} height={28} />,
  },
];

const COLOSSEUM_SPLIT_TYPES: SplitMetadata[] = [
  {
    type: SplitType.COLOSSEUM_CHALLENGE,
    name: 'Challenge Time',
    description: 'Best challenge (in-wave) completion time',
    icon: 'fas fa-flag-checkered',
    fullWidth: true,
  },
  {
    type: SplitType.COLOSSEUM_WAVE_1,
    name: 'Wave 1',
    description: 'Best Wave 1 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_2,
    name: 'Wave 2',
    description: 'Best Wave 2 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_3,
    name: 'Wave 3',
    description: 'Best Wave 3 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_4,
    name: 'Wave 4',
    description: 'Best Wave 4 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_5,
    name: 'Wave 5',
    description: 'Best Wave 5 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_6,
    name: 'Wave 6',
    description: 'Best Wave 6 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_7,
    name: 'Wave 7',
    description: 'Best Wave 7 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_8,
    name: 'Wave 8',
    description: 'Best Wave 8 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_9,
    name: 'Wave 9',
    description: 'Best Wave 9 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_10,
    name: 'Wave 10',
    description: 'Best Wave 10 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_11,
    name: 'Wave 11',
    description: 'Best Wave 11 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.COLOSSEUM_WAVE_12,
    name: 'Sol Heredit',
    description: 'Best Sol Heredit completion time',
    icon: 'fas fa-stopwatch',
  },
];

const MOKHAIOTL_SPLIT_TYPES: SplitMetadata[] = [
  {
    type: SplitType.MOKHAIOTL_CHALLENGE,
    name: 'Delve 1-8 Challenge Time',
    description: 'Best delve 1-8 completion time',
    icon: 'fas fa-flag-checkered',
    fullWidth: true,
  },
  {
    type: SplitType.MOKHAIOTL_DELVE_1,
    name: 'Delve 1',
    description: 'Best delve 1 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.MOKHAIOTL_DELVE_2,
    name: 'Delve 2',
    description: 'Best delve 2 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.MOKHAIOTL_DELVE_3,
    name: 'Delve 3',
    description: 'Best delve 3 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.MOKHAIOTL_DELVE_4,
    name: 'Delve 4',
    description: 'Best delve 4 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.MOKHAIOTL_DELVE_5,
    name: 'Delve 5',
    description: 'Best delve 5 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.MOKHAIOTL_DELVE_6,
    name: 'Delve 6',
    description: 'Best delve 6 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.MOKHAIOTL_DELVE_7,
    name: 'Delve 7',
    description: 'Best delve 7 completion time',
    icon: 'fas fa-stopwatch',
  },
  {
    type: SplitType.MOKHAIOTL_DELVE_8,
    name: 'Delve 8',
    description: 'Best delve 8 completion time',
    icon: 'fas fa-stopwatch',
  },
];

const TOB_SCALES = [1, 2, 3, 4, 5] as Scale[];

function scaleName(scale: Scale): string {
  return scale === 1
    ? 'Solo'
    : scale === 2
      ? 'Duo'
      : scale === 3
        ? 'Trio'
        : scale === 4
          ? '4-man'
          : '5-man';
}

function typeParamToSelection(
  typeParam: string | null,
): [ChallengeType, ChallengeMode] {
  switch (typeParam) {
    case 'tob':
      return [ChallengeType.TOB, ChallengeMode.TOB_REGULAR];
    case 'hmt':
      return [ChallengeType.TOB, ChallengeMode.TOB_HARD];
    case 'colo':
      return [ChallengeType.COLOSSEUM, ChallengeMode.NO_MODE];
    case 'mok':
      return [ChallengeType.MOKHAIOTL, ChallengeMode.NO_MODE];
    default:
      return [ChallengeType.TOB, ChallengeMode.TOB_REGULAR];
  }
}

function selectionToTypeParam(
  type: ChallengeType,
  mode: ChallengeMode,
): string {
  if (type === ChallengeType.TOB && mode === ChallengeMode.TOB_REGULAR) {
    return 'tob';
  }
  if (type === ChallengeType.TOB && mode === ChallengeMode.TOB_HARD) {
    return 'hmt';
  }
  if (type === ChallengeType.COLOSSEUM) {
    return 'colo';
  }
  if (type === ChallengeType.MOKHAIOTL) {
    return 'mok';
  }
  return 'tob';
}

type PersonalBestMap = {
  [split in SplitType]?: {
    [scale in Scale]?: PersonalBest;
  };
};

function buildPersonalBestMap(pbs: PersonalBest[]): PersonalBestMap {
  return pbs.reduce((acc, pb) => {
    acc[pb.type] = {
      ...acc[pb.type],
      [pb.scale]: pb,
    };
    return acc;
  }, {} as PersonalBestMap);
}

function PersonalBestCard({
  pb,
  scale,
}: {
  pb: PersonalBest | null;
  scale: Scale;
}) {
  if (pb === null) {
    return (
      <div className={styles.pbCard}>
        <div className={styles.pbScale}>{scaleName(scale)}</div>
        <div className={styles.pbTime}>--:--.-</div>
        <div className={styles.pbDate}>No completion</div>
      </div>
    );
  }

  return (
    <Link
      href={challengeUrl(ChallengeType.TOB, pb.cid)}
      className={`${styles.pbCard} ${styles.hasTime}`}
    >
      <div className={styles.pbScale}>{scaleName(scale)}</div>
      <div className={styles.pbTime}>{ticksToFormattedSeconds(pb.ticks)}</div>
      <div className={styles.pbDate}>
        {pb.date?.toLocaleDateString() ?? 'Unknown date'}
      </div>
    </Link>
  );
}

function AchievementCard({ achievement }: { achievement: Achievement }) {
  const cardContent = (
    <>
      <div className={styles.achievementIcon}>
        <i className={achievement.icon} />
      </div>
      <div className={styles.achievementContent}>
        <div className={styles.achievementLabel}>{achievement.name}</div>
        <div className={styles.achievementValue}>{achievement.value}</div>
        {achievement.date && (
          <div className={styles.achievementDate}>
            {achievement.date.toLocaleDateString()}
          </div>
        )}
      </div>
    </>
  );

  return (
    <Link
      href={challengeUrl(achievement.challengeType, achievement.challengeId)}
      className={`${styles.achievementCard} ${styles.hasValue}`}
    >
      {cardContent}
    </Link>
  );
}

function AchievementSection({
  title,
  achievements,
}: {
  title: string;
  achievements: Achievement[];
}) {
  if (achievements.length === 0) {
    return null;
  }

  return (
    <div className={styles.achievementSection}>
      <div className={styles.splitHeader}>
        <div className={styles.splitIcon}>
          <i className="fas fa-trophy" />
        </div>
        <div className={styles.splitInfo}>
          <h3>{title}</h3>
          <p>Notable achievements and records</p>
        </div>
      </div>
      <div className={styles.achievementGrid}>
        {achievements.map((achievement, index) => (
          <AchievementCard key={index} achievement={achievement} />
        ))}
      </div>
    </div>
  );
}

function SplitTypeSection({
  pbs,
  mode,
  type,
  scales,
}: {
  mode: ChallengeMode;
  type: SplitMetadata;
  pbs: PersonalBestMap;
  scales: Scale[];
}) {
  const sectionClasses = `${styles.splitSection} ${
    type.fullWidth ? styles.fullWidth : ''
  }`;

  return (
    <div className={sectionClasses}>
      <div className={styles.splitHeader}>
        {typeof type.icon === 'string' ? (
          <i className={`${type.icon} ${styles.splitIcon}`} />
        ) : (
          <div className={styles.splitIcon}>{type.icon}</div>
        )}
        <div className={styles.splitInfo}>
          <h3>{type.name}</h3>
          <p>{type.description}</p>
        </div>
      </div>
      <div className={styles.pbGrid}>
        {scales.map((scale) => (
          <PersonalBestCard
            key={scale}
            pb={pbs[adjustSplitForMode(type.type, mode)]?.[scale] ?? null}
            scale={scale}
          />
        ))}
      </div>
    </div>
  );
}

export default function PlayerPersonalBests() {
  const player = usePlayer();
  const display = useContext(DisplayContext);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [[type, mode], setSelection] = useState<[ChallengeType, ChallengeMode]>(
    () => {
      const typeParam = searchParams.get('type');
      return typeParamToSelection(typeParam);
    },
  );

  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const username = player.username;

  useEffect(() => {
    const typeParam = searchParams.get('type');
    const newSelection = typeParamToSelection(typeParam);
    setSelection(newSelection);
  }, [searchParams]);

  useEffect(() => {
    if (type === ChallengeType.MOKHAIOTL) {
      const fetchData = async () => {
        const params = {
          party: username,
          type: ChallengeType.MOKHAIOTL,
          options: 'stats',
          sort: '-mok:maxCompletedDelve',
          limit: 1,
        };
        try {
          const res = await fetch(`/api/v1/challenges?${queryString(params)}`);
          const challenges = await res.json();

          const newAchievements: Achievement[] = [];

          if (challenges && challenges.length > 0) {
            const challenge = challenges[0];

            if (challenge.mokhaiotlStats?.maxCompletedDelve !== undefined) {
              newAchievements.push({
                name: 'Deepest delve completed',
                value: `Delve ${challenge.mokhaiotlStats.maxCompletedDelve}`,
                icon: 'fas fa-mountain',
                date: new Date(challenge.finishTime),
                challengeId: challenge.uuid,
                challengeType: ChallengeType.MOKHAIOTL,
              });
            }
          }

          setAchievements(newAchievements);
        } catch (e) {
          console.error(e);
          setAchievements([]);
        }
      };

      fetchData();
    } else {
      setAchievements([]);
    }
  }, [type, username]);

  const pbs = buildPersonalBestMap(player.personalBests);

  let splitTypes: SplitMetadata[] = [];
  let scales: Scale[] = [1];

  switch (type) {
    case ChallengeType.TOB:
      splitTypes = TOB_SPLIT_TYPES;
      scales = TOB_SCALES;
      break;
    case ChallengeType.COLOSSEUM:
      splitTypes = COLOSSEUM_SPLIT_TYPES;
      break;
    case ChallengeType.MOKHAIOTL:
      splitTypes = MOKHAIOTL_SPLIT_TYPES;
      break;
  }

  const isSolo = scales.length === 1;

  return (
    <div className={styles.personalBests}>
      <Card className={styles.selection}>
        <RadioInput.Group
          name="personal-bests-challenge"
          className={styles.pbOptions}
          simple
          onChange={(value) => {
            let newSelection: [ChallengeType, ChallengeMode];
            switch (value) {
              case 'tob':
                newSelection = [ChallengeType.TOB, ChallengeMode.TOB_REGULAR];
                break;
              case 'hmt':
                newSelection = [ChallengeType.TOB, ChallengeMode.TOB_HARD];
                break;
              case 'colo':
                newSelection = [ChallengeType.COLOSSEUM, ChallengeMode.NO_MODE];
                break;
              case 'mok':
                newSelection = [ChallengeType.MOKHAIOTL, ChallengeMode.NO_MODE];
                break;
              default:
                return;
            }

            setSelection(newSelection);

            const newParams = new URLSearchParams(searchParams.toString());
            newParams.set('type', value);
            router.replace(
              `${window.location.pathname}?${newParams.toString()}`,
            );
          }}
        >
          <RadioInput.Option
            checked={
              type === ChallengeType.TOB && mode === ChallengeMode.TOB_REGULAR
            }
            id="personal-bests-challenge-tob"
            value="tob"
            label={
              <span className={styles.pbOption}>
                <Image
                  src={challengeLogo(ChallengeType.TOB)}
                  alt={challengeName(ChallengeType.TOB)}
                  width={24}
                  height={24}
                  style={{ objectFit: 'contain' }}
                />
                {display.isCompact() ? 'ToB' : 'ToB Regular Mode'}
              </span>
            }
          />
          <RadioInput.Option
            checked={
              type === ChallengeType.TOB && mode === ChallengeMode.TOB_HARD
            }
            id="personal-bests-challenge-hmt"
            value="hmt"
            label={
              <span className={styles.pbOption}>
                <Image
                  src={challengeLogo(ChallengeType.TOB)}
                  alt={challengeName(ChallengeType.TOB)}
                  width={24}
                  height={24}
                  style={{ objectFit: 'contain' }}
                />
                {display.isCompact() ? 'HMT' : 'ToB Hard Mode'}
              </span>
            }
          />
          <RadioInput.Option
            checked={type === ChallengeType.COLOSSEUM}
            id="personal-bests-challenge-colo"
            value="colo"
            label={
              <span className={styles.pbOption}>
                <Image
                  src={challengeLogo(ChallengeType.COLOSSEUM)}
                  alt={challengeName(ChallengeType.COLOSSEUM)}
                  width={24}
                  height={24}
                  style={{ objectFit: 'contain' }}
                />
                {display.isCompact() ? 'Colo' : 'Fortis Colosseum'}
              </span>
            }
          />
          <RadioInput.Option
            checked={type === ChallengeType.MOKHAIOTL}
            id="personal-bests-challenge-mok"
            value="mok"
            label={
              <span className={styles.pbOption}>
                <Image
                  src={challengeLogo(ChallengeType.MOKHAIOTL)}
                  alt={challengeName(ChallengeType.MOKHAIOTL)}
                  width={24}
                  height={24}
                  style={{ objectFit: 'contain' }}
                />
                {display.isCompact() ? 'Mok' : 'Mokhaiotl'}
              </span>
            }
          />
        </RadioInput.Group>
      </Card>
      <div className={`${styles.pbContent} ${isSolo ? styles.soloLayout : ''}`}>
        {achievements.length > 0 && (
          <AchievementSection
            title="Achievements"
            achievements={achievements}
          />
        )}
        {isSolo ? (
          <div className={styles.splitsContainer}>
            {splitTypes.map((type) => (
              <SplitTypeSection
                key={type.type}
                mode={mode}
                type={type}
                pbs={pbs}
                scales={scales}
              />
            ))}
          </div>
        ) : (
          splitTypes.map((type) => (
            <SplitTypeSection
              key={type.type}
              mode={mode}
              type={type}
              pbs={pbs}
              scales={scales}
            />
          ))
        )}
      </div>
    </div>
  );
}
