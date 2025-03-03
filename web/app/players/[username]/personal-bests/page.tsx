'use client';

import {
  adjustSplitForMode,
  ChallengeMode,
  ChallengeType,
  SplitType,
} from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import { useContext, useState } from 'react';

import { PersonalBest } from '@/actions/challenge';
import { Card } from '@/components/card/card';
import RadioInput from '@/components/radio-input';
import { DisplayContext } from '@/display';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

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
};

const TOB_SPLIT_TYPES: SplitMetadata[] = [
  {
    type: SplitType.TOB_CHALLENGE,
    name: 'Challenge Time',
    description: 'Best challenge (in-room) completion time',
    icon: 'fas fa-flag-checkered',
  },
  {
    type: SplitType.TOB_OVERALL,
    name: 'Overall Time',
    description: 'Best overall (real time) raid completion time',
    icon: 'fas fa-clock',
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
  return (
    <div className={styles.splitSection}>
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

  const [[type, mode], setSelection] = useState<[ChallengeType, ChallengeMode]>(
    [ChallengeType.TOB, ChallengeMode.TOB_REGULAR],
  );

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
  }

  return (
    <div className={styles.personalBests}>
      <Card className={styles.selection}>
        <RadioInput.Group
          name="personal-bests-challenge"
          className={styles.pbOptions}
          simple
          onChange={(value) => {
            switch (value) {
              case 'tob':
                setSelection([ChallengeType.TOB, ChallengeMode.TOB_REGULAR]);
                break;
              case 'hmt':
                setSelection([ChallengeType.TOB, ChallengeMode.TOB_HARD]);
                break;
              case 'colo':
                setSelection([ChallengeType.COLOSSEUM, ChallengeMode.NO_MODE]);
                break;
            }
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
                  src="/logo_tob.webp"
                  alt="Theatre of Blood Logo"
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
                  src="/logo_tob.webp"
                  alt="Theatre of Blood Logo"
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
                  src="/varlamore.png"
                  alt="Fortis Colosseum Logo"
                  width={24}
                  height={24}
                  style={{ objectFit: 'contain' }}
                />
                {display.isCompact() ? 'Colo' : 'Fortis Colosseum'}
              </span>
            }
          />
        </RadioInput.Group>
      </Card>
      <div className={styles.pbContent}>
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
    </div>
  );
}
