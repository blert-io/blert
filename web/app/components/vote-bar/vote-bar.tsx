'use client';

import styles from './style.module.scss';

export type VoteType = 'like' | 'dislike';

export type VoteBarProps = {
  likes: number;
  dislikes: number;
  currentVote: VoteType | null;
  disabled?: boolean;
  loading?: boolean;
  width?: number | string;
  onVote?: (type: VoteType) => void;
  onRemoveVote?: () => void;
};

export default function VoteBar({
  likes,
  dislikes,
  currentVote,
  disabled = false,
  loading = false,
  width,
  onVote,
  onRemoveVote,
}: VoteBarProps) {
  const total = likes + dislikes;
  const likePercentage = total > 0 ? (likes / total) * 100 : 50;

  const handleClick = (voteType: VoteType) => {
    if (disabled || loading || (!onVote && !onRemoveVote)) {
      return;
    }

    if (currentVote === voteType) {
      onRemoveVote?.();
    } else {
      onVote?.(voteType);
    }
  };

  return (
    <div className={styles.voteBar} style={{ width }}>
      <button
        className={`${styles.voteButton} ${styles.like} ${
          currentVote === 'like' ? styles.active : ''
        }`}
        disabled={disabled || loading}
        onClick={() => handleClick('like')}
      >
        <i className="fas fa-thumbs-up" />
        <span>{likes}</span>
      </button>

      <div className={styles.barContainer}>
        <div className={styles.bar} style={{ width: `${likePercentage}%` }} />
      </div>

      <button
        className={`${styles.voteButton} ${styles.dislike} ${
          currentVote === 'dislike' ? styles.active : ''
        }`}
        disabled={disabled || loading}
        onClick={() => handleClick('dislike')}
      >
        <i className="fas fa-thumbs-down" />
        <span>{dislikes}</span>
      </button>
    </div>
  );
}
