import Image from 'next/image';
import { CSSProperties, ReactNode } from 'react';

import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { ticksToFormattedSeconds } from '@/utils/tick';

import styles from './style.module.scss';

export type BossFightOverviewSection = {
  title: string;
  content: ReactNode;
  span?: number;
};

/** An additional stat displayed under the stage duration. */
export type BossFightOverviewStat = {
  faIcon: string;
  value: ReactNode;
  tooltip?: string;
};

interface BossFightOverviewProps {
  name: string;
  className?: string;
  image: string;
  time: number;
  stats?: BossFightOverviewStat[];
  sections?: BossFightOverviewSection[];
}

export function BossFightOverview({
  name,
  className,
  image,
  time,
  stats = [],
  sections = [],
}: BossFightOverviewProps) {
  return (
    <div className={`${styles.bossFightOverview} ${className ?? ''}`}>
      <div className={styles.bossInfo}>
        <div className={styles.header}>
          <div className={styles.imageWrapper}>
            <Image src={image} alt={name} fill className={styles.bossImage} />
          </div>
          <div className={styles.titleSection}>
            <h1>{name}</h1>
            <div className={styles.stat}>
              <i className="far fa-clock" />
              {ticksToFormattedSeconds(time)}
            </div>
            {stats.map(({ faIcon, value, tooltip }, index) => (
              <div
                key={index}
                className={`${styles.stat} ${tooltip !== undefined ? styles.tooltip : ''}`}
                data-tooltip-id={
                  tooltip !== undefined ? GLOBAL_TOOLTIP_ID : undefined
                }
                data-tooltip-content={tooltip}
              >
                <i className={faIcon} />
                <span className={styles.value}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {sections.length > 0 && (
        <div className={styles.content}>
          {sections.map((section) => (
            <div
              key={section.title}
              className={styles.section}
              style={
                section.span !== undefined
                  ? ({ '--span': section.span } as CSSProperties)
                  : undefined
              }
            >
              <h3>{section.title}</h3>
              <div className={styles.sectionContent}>{section.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
