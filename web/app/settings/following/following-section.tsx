'use client';

import { useCallback, useRef, useState } from 'react';

import {
  FollowedPlayer,
  FollowingResult,
  unfollowPlayer,
} from '@/actions/feed';
import FollowingList, { type PlayerItem } from '@/components/following-list';
import { useToast } from '@/components/toast';

import styles from '../style.module.scss';

const PAGE_SIZE = 30;

type FollowingSectionProps = {
  initialPlayers: FollowedPlayer[];
  totalCount: number;
  initialCursor: string | null;
};

export default function FollowingSection({
  initialPlayers,
  totalCount: initialTotalCount,
  initialCursor,
}: FollowingSectionProps) {
  const [players, setPlayers] = useState(initialPlayers);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingActions, setPendingActions] = useState<Set<number>>(new Set());
  const showToast = useToast();

  const hasMore = cursor !== null;
  const loadMoreInFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadMoreInFlight.current || cursor === null) {
      return;
    }

    loadMoreInFlight.current = true;
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/following?cursor=${encodeURIComponent(cursor)}&limit=${PAGE_SIZE}`,
      );

      if (!response.ok) {
        throw new Error('Failed to load more players');
      }

      const result = (await response.json()) as FollowingResult;
      const newPlayers = result.players.map((p) => ({
        ...p,
        followedAt: new Date(p.followedAt),
      }));

      setPlayers((prev) => [...prev, ...newPlayers]);
      setCursor(result.cursor);
    } catch {
      showToast('Failed to load more players. Please try again.', 'error');
    } finally {
      loadMoreInFlight.current = false;
      setIsLoading(false);
    }
  }, [cursor, showToast]);

  const handleUnfollow = useCallback(
    async (player: PlayerItem) => {
      setPendingActions((prev) => new Set(prev).add(player.id));

      try {
        await unfollowPlayer(player.id);
        setPlayers((prev) => prev.filter((p) => p.id !== player.id));
        setTotalCount((prev) => prev - 1);
      } catch {
        showToast('Failed to unfollow player. Please try again.', 'error');
      } finally {
        setPendingActions((prev) => {
          const next = new Set(prev);
          next.delete(player.id);
          return next;
        });
      }
    },
    [showToast],
  );

  const handleFollow = useCallback(() => {
    // Not used on this page - all players are already followed
  }, []);

  const playerItems: PlayerItem[] = players.map((p) => ({
    id: p.id,
    username: p.username,
    isFollowed: true,
    isPending: pendingActions.has(p.id),
  }));

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>
          <i className="fas fa-users" />
          Following
          {totalCount > 0 && (
            <span
              style={{
                fontWeight: 400,
                color: 'var(--blert-font-color-secondary)',
                marginLeft: 8,
              }}
            >
              ({totalCount})
            </span>
          )}
        </h2>
        <p className={styles.description}>
          Players you follow will appear in your dashboard feed.
        </p>
      </div>

      <FollowingList
        players={playerItems}
        onFollow={handleFollow}
        onUnfollow={handleUnfollow}
        onLoadMore={loadMore}
        isLoading={isLoading}
        hasMore={hasMore}
      />
    </div>
  );
}
