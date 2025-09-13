import Image from 'next/image';
import { ReactNode } from 'react';

import { ticksToFormattedSeconds } from '@/utils/tick';

import styles from './style.module.scss';

export type BossFightOverviewSection = {
  title: string;
  content: ReactNode;
  span?: number;
};

interface BossFightOverviewProps {
  name: string;
  className?: string;
  image: string;
  time: number;
  sections?: Array<BossFightOverviewSection>;
}

export function BossFightOverview({
  name,
  className,
  image,
  time,
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
            <div className={styles.time}>
              <i className="far fa-clock" />
              {ticksToFormattedSeconds(time)}
            </div>
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
                section.span
                  ? { gridColumn: `span ${section.span}` }
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
