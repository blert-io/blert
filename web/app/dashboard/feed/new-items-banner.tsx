'use client';

import styles from './feed.module.scss';

type NewItemsBannerProps = {
  count: number;
  onClick: () => void;
};

export default function NewItemsBanner({
  count,
  onClick,
}: NewItemsBannerProps) {
  return (
    <div className={styles.newItemsBanner}>
      <button className={styles.newItemsButton} onClick={onClick}>
        <i className="fas fa-arrow-up" />
        {count} new {count === 1 ? 'item' : 'items'}
      </button>
    </div>
  );
}
