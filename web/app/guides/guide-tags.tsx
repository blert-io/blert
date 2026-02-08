import { ChallengeType, challengeName } from '@blert/common';

import styles from './style.module.scss';

const CHALLENGE_TYPE_MAP = {
  tob: ChallengeType.TOB,
  cox: ChallengeType.COX,
  toa: ChallengeType.TOA,
  colosseum: ChallengeType.COLOSSEUM,
  inferno: ChallengeType.INFERNO,
  mokhaiotl: ChallengeType.MOKHAIOTL,
} as const;

type GuideTagsProps = {
  challenge: ChallengeType | keyof typeof CHALLENGE_TYPE_MAP;
  scale: number | 'all';
  level: 'learner' | 'intermediate' | 'max-eff' | 'speedrun';
};

function levelName(level: 'learner' | 'intermediate' | 'max-eff' | 'speedrun') {
  switch (level) {
    case 'learner':
      return 'Learner';
    case 'intermediate':
      return 'Intermediate';
    case 'max-eff':
      return 'Max Eff';
    case 'speedrun':
      return 'Speedrun';
  }
}

export default function GuideTags({ challenge, scale, level }: GuideTagsProps) {
  const challengeType =
    typeof challenge === 'string' ? CHALLENGE_TYPE_MAP[challenge] : challenge;

  return (
    <div className={styles.tags}>
      <div className={styles.tag}>
        <i className="fas fa-trophy" />
        {challengeType !== undefined ? challengeName(challengeType) : challenge}
      </div>
      <div className={styles.tag}>
        <i className="fas fa-users" />
        {scale}
      </div>
      <div className={styles.tag}>
        <i className="fas fa-gauge-high" />
        {levelName(level)}
      </div>
    </div>
  );
}
