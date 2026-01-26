'use client';

import { useEffect, useRef } from 'react';

import PlayerAvatar from '@/components/player-avatar';
import PlayerLink from '@/components/player-link';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import styles from './following-list.module.scss';

export type PlayerItem = {
  id: number;
  username: string;
  isFollowed: boolean;
  isPending?: boolean;
};

type FollowingListProps = {
  players: PlayerItem[];
  onFollow: (player: PlayerItem) => void | Promise<void>;
  onUnfollow: (player: PlayerItem) => void | Promise<void>;
  onLoadMore?: () => void | Promise<void>;
  isLoading?: boolean;
  hasMore?: boolean;
};

function PlayerRowSkeleton() {
  return (
    <li className={styles.playerItem}>
      <div className={styles.playerInfo}>
        <div className={`${styles.skeleton} ${styles.skeletonAvatar}`} />
        <div className={`${styles.skeleton} ${styles.skeletonName}`} />
      </div>
      <div className={`${styles.skeleton} ${styles.skeletonButton}`} />
    </li>
  );
}

export default function FollowingList({
  players,
  onFollow,
  onUnfollow,
  onLoadMore,
  isLoading,
  hasMore,
}: FollowingListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || !hasMore || onLoadMore === undefined) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          void onLoadMore();
        }
      },
      { rootMargin: '100px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isLoading, onLoadMore]);

  if (players.length === 0 && !isLoading) {
    return (
      <div className={styles.emptyState}>
        <i className="fas fa-user-plus" />
        <p>No players to show.</p>
      </div>
    );
  }

  return (
    <div className={styles.followingList}>
      <ul className={styles.playerList}>
        {players.map((player) => {
          const buttonClass = player.isFollowed
            ? styles.unfollowButton
            : styles.followButton;
          const buttonIcon = player.isFollowed ? 'fas fa-times' : 'fas fa-plus';
          const buttonTooltip = player.isFollowed ? 'Unfollow' : 'Follow';
          const handleClick = () => {
            void (player.isFollowed ? onUnfollow(player) : onFollow(player));
          };

          return (
            <li key={player.id} className={styles.playerItem}>
              <PlayerLink
                className={styles.playerInfo}
                username={player.username}
              >
                <PlayerAvatar id={player.id} username={player.username} />
                <span className={styles.playerName}>{player.username}</span>
              </PlayerLink>
              <button
                onClick={handleClick}
                disabled={player.isPending}
                className={buttonClass}
                data-tooltip-id={GLOBAL_TOOLTIP_ID}
                data-tooltip-content={buttonTooltip}
              >
                {player.isPending ? (
                  <i className="fas fa-spinner fa-spin" />
                ) : (
                  <i className={buttonIcon} />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Sentinel element for infinite scroll */}
      {hasMore && <div ref={sentinelRef} className={styles.sentinel} />}

      {isLoading && (
        <ul className={styles.playerList}>
          <PlayerRowSkeleton />
          <PlayerRowSkeleton />
          <PlayerRowSkeleton />
        </ul>
      )}
    </div>
  );
}
