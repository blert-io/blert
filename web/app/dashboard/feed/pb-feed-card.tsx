'use client';

import { ChallengeMode, challengeName, splitName } from '@blert/common';
import { useRouter } from 'next/navigation';
import { MouseEvent } from 'react';
import TimeAgo from 'react-timeago';

import { PersonalBestFeedItem } from '@/actions/feed';
import PlayerLink from '@/components/player-link';
import { useClientOnly } from '@/hooks/client-only';
import { scaleNameAndColor } from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import styles from './feed.module.scss';

type PbFeedCardProps = {
  item: PersonalBestFeedItem;
};

function formatSplitName(item: PersonalBestFeedItem): string {
  const name = splitName(item.splitType);
  switch (item.challengeMode) {
    case ChallengeMode.TOB_ENTRY:
      return `${name} (Entry)`;
    case ChallengeMode.TOB_HARD:
      return `${name} (HM)`;
  }
  return name;
}

export default function PbFeedCard({ item }: PbFeedCardProps) {
  const router = useRouter();
  const isClient = useClientOnly();

  const [scaleString] = scaleNameAndColor(item.scale);
  const formattedTime = ticksToFormattedSeconds(item.ticks);

  const improvement =
    item.previousTicks !== undefined && item.previousTicks !== null
      ? item.previousTicks - item.ticks
      : null;

  const url = challengeUrl(item.challengeType, item.challengeUuid);

  const handleCardClick = () => {
    router.push(url);
  };

  const splitHeadline = `${scaleString} ${formatSplitName(item)} PB`;

  return (
    <div
      className={`${styles.feedCard} ${styles.pbCard}`}
      onClick={handleCardClick}
    >
      <div className={styles.cardHeader}>
        <div className={styles.pbHeadline}>
          <i className="fas fa-trophy" />
          <span className={styles.pbSplitName}>{splitHeadline}</span>
        </div>
        <div className={styles.cardHeaderRight}>
          <span className={styles.timestamp}>
            {isClient && <TimeAgo date={item.timestamp} />}
          </span>
          <i className={`fas fa-chevron-right ${styles.cardArrow}`} />
        </div>
      </div>

      <div className={styles.pbBody}>
        <div className={styles.pbContext}>
          <PlayerLink
            username={item.player}
            className={styles.followed}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
            }}
          />
          <span className={styles.pbChallenge}>
            {challengeName(item.challengeType)}
          </span>
        </div>

        <div className={styles.pbTime}>
          <span className={styles.newTime}>{formattedTime}</span>
          {improvement !== null && improvement > 0 && (
            <span className={styles.improvement}>
              <i className="fas fa-arrow-down" />
              {ticksToFormattedSeconds(improvement)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
