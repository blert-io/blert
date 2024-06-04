import { Skill, SkillLevel } from '@blert/common';
import Image from 'next/image';

import styles from './style.module.scss';

type PlayerSkillProps = {
  className?: string;
  skill: Skill;
  level: SkillLevel;
  thresholds?: {
    high: number;
    low: number;
  };
};

const skills = {
  [Skill.OVERALL]: ['Overall', '/images/skills/overall.webp'],
  [Skill.ATTACK]: ['Attack', '/images/skills/attack.webp'],
  [Skill.DEFENCE]: ['Defence', '/images/skills/defence.webp'],
  [Skill.STRENGTH]: ['Strength', '/images/skills/strength.webp'],
  [Skill.HITPOINTS]: ['Hitpoints', '/images/skills/hitpoints.webp'],
  [Skill.PRAYER]: ['Prayer', '/images/skills/prayer.webp'],
  [Skill.RANGED]: ['Ranged', '/images/skills/ranged.png'],
  [Skill.MAGIC]: ['Magic', '/images/skills/magic.png'],
};

export function PlayerSkill({
  className,
  skill,
  level,
  thresholds,
}: PlayerSkillProps) {
  const [name, url] = skills[skill];

  let skillClass = styles.skill;
  if (className) {
    skillClass += ` ${className}`;
  }
  if (thresholds) {
    if (level.getCurrent() >= thresholds.high) {
      skillClass += ` ${styles.high}`;
    } else if (level.getCurrent() <= thresholds.low) {
      skillClass += ` ${styles.low}`;
    } else {
      skillClass += ` ${styles.medium}`;
    }
  }

  return (
    <div className={skillClass}>
      <Image src={url} alt={name} width={16} height={16} />
      {level.getCurrent()}
    </div>
  );
}
