'use client';

import { useRouter } from 'next/navigation';
import TimeAgo from 'react-timeago';

import { NameChangeFeedItem } from '@/actions/feed';
import { useClientOnly } from '@/hooks/client-only';

import styles from './feed.module.scss';

type NameChangeFeedCardProps = {
  item: NameChangeFeedItem;
};

export default function NameChangeFeedCard({ item }: NameChangeFeedCardProps) {
  const router = useRouter();
  const isClient = useClientOnly();

  const handleCardClick = () => {
    router.push(`/players/${encodeURIComponent(item.currentName)}`);
  };

  return (
    <div
      className={`${styles.feedCard} ${styles.nameChangeCard}`}
      onClick={handleCardClick}
    >
      <div className={styles.cardHeader}>
        <div className={styles.nameChangeBadge}>
          <i className="fas fa-id-card" />
          <span>Name Change</span>
        </div>
        <div className={styles.cardHeaderRight}>
          <span className={styles.timestamp}>
            {isClient && <TimeAgo date={item.timestamp} />}
          </span>
          <i className={`fas fa-chevron-right ${styles.cardArrow}`} />
        </div>
      </div>

      <div className={styles.nameChangeBody}>
        <span className={styles.oldName}>{item.oldName}</span>
        <i className="fas fa-arrow-right" />
        <span className={styles.newName}>{item.newName}</span>
      </div>
    </div>
  );
}
