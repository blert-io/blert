import { ChallengeType, challengeName } from '@blert/common';

import styles from './style.module.scss';

type GuideTagsProps = {
  challenge: ChallengeType;
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
  return (
    <div className={styles.tags}>
      <div className={styles.tag}>
        <i className="fas fa-trophy" />
        {challengeName(challenge)}
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
