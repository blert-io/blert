'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import {
  FollowedPlayer,
  SuggestedPlayer,
  followPlayer,
  getSuggestedPlayers,
  unfollowPlayer,
} from '@/actions/feed';
import FollowingList, { type PlayerItem } from '@/components/following-list';
import { useToast } from '@/components/toast';

import styles from './follow-manager.module.scss';

const SUGGESTIONS_DISPLAY_LIMIT = 5;
const SUGGESTIONS_FETCH_SIZE = 20;
const SUGGESTIONS_REFETCH_THRESHOLD = 10;

type FollowManagerProps = {
  initialFollowing: FollowedPlayer[];
  initialFollowingCount: number;
  initialSuggestions: SuggestedPlayer[];
  onPlayerFollowed?: (player: FollowedPlayer) => void;
  onPlayerUnfollowed?: (playerId: number) => void;
};

export default function FollowManager({
  initialFollowing,
  initialFollowingCount,
  initialSuggestions,
  onPlayerFollowed,
  onPlayerUnfollowed,
}: FollowManagerProps) {
  const [following, setFollowing] = useState(initialFollowing);
  const [followingCount, setFollowingCount] = useState(initialFollowingCount);
  const [suggestionPool, setSuggestionPool] = useState(initialSuggestions);
  const [pendingActions, setPendingActions] = useState<Set<number>>(new Set());
  const isFetchingSuggestions = useRef(false);
  const showToast = useToast();

  useEffect(() => {
    setFollowing(initialFollowing);
    setFollowingCount(initialFollowingCount);
  }, [initialFollowing, initialFollowingCount]);

  useEffect(() => {
    setSuggestionPool(initialSuggestions);
  }, [initialSuggestions]);

  // Fetch more suggestions when pool runs low.
  const fetchMoreSuggestions = useCallback(
    async (currentPool: SuggestedPlayer[]) => {
      if (isFetchingSuggestions.current) {
        return;
      }

      isFetchingSuggestions.current = true;

      try {
        const excludeIds = currentPool.map((p) => p.id);
        const newSuggestions = await getSuggestedPlayers({
          limit: SUGGESTIONS_FETCH_SIZE,
          exclude: excludeIds,
        });

        if (newSuggestions.length > 0) {
          setSuggestionPool((prev) => [...prev, ...newSuggestions]);
        }
      } finally {
        isFetchingSuggestions.current = false;
      }
    },
    [],
  );

  const handleUnfollow = useCallback(
    async (player: PlayerItem) => {
      setPendingActions((prev) => new Set(prev).add(player.id));

      try {
        await unfollowPlayer(player.id);
        setFollowing((prev) => prev.filter((p) => p.id !== player.id));
        setFollowingCount((prev) => prev - 1);
        onPlayerUnfollowed?.(player.id);
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
    [onPlayerUnfollowed, showToast],
  );

  const handleFollow = useCallback(
    async (player: PlayerItem) => {
      setPendingActions((prev) => new Set(prev).add(player.id));

      try {
        const followed = await followPlayer(player.username);
        if (followed !== null) {
          setFollowing((prev) => [followed, ...prev]);
          setFollowingCount((prev) => prev + 1);

          // Remove from pool.
          const newPool = suggestionPool.filter((p) => p.id !== player.id);
          setSuggestionPool(newPool);

          // Trigger refetch if pool is running low.
          if (newPool.length < SUGGESTIONS_REFETCH_THRESHOLD) {
            void fetchMoreSuggestions(newPool);
          }

          onPlayerFollowed?.(followed);
        }
      } catch {
        showToast('Failed to follow player. Please try again.', 'error');
      } finally {
        setPendingActions((prev) => {
          const next = new Set(prev);
          next.delete(player.id);
          return next;
        });
      }
    },
    [fetchMoreSuggestions, onPlayerFollowed, showToast, suggestionPool],
  );

  const followingItems: PlayerItem[] = following.slice(0, 10).map((p) => ({
    id: p.id,
    username: p.username,
    isFollowed: true,
    isPending: pendingActions.has(p.id),
  }));

  const followingIds = new Set(following.map((f) => f.id));
  const displayedSuggestions = suggestionPool
    .filter((p) => !followingIds.has(p.id))
    .slice(0, SUGGESTIONS_DISPLAY_LIMIT);
  const suggestionItems: PlayerItem[] = displayedSuggestions.map((p) => ({
    id: p.id,
    username: p.username,
    isFollowed: false,
    isPending: pendingActions.has(p.id),
  }));

  return (
    <div className={styles.followManager}>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <i className="fas fa-users" />
          <span className={styles.sectionTitle}>Following</span>
          <span className={styles.count}>{followingCount}</span>
        </div>

        <FollowingList
          players={followingItems}
          onFollow={handleFollow}
          onUnfollow={handleUnfollow}
        />

        {followingCount > 10 && (
          <Link href="/settings/following" className={styles.viewAllLink}>
            View all {followingCount} followed players
            <i className="fas fa-arrow-right" />
          </Link>
        )}
      </div>

      {suggestionPool.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <i className="fas fa-user-plus" />
            <span className={styles.sectionTitle}>Suggested</span>
          </div>

          <FollowingList
            players={suggestionItems}
            onFollow={handleFollow}
            onUnfollow={handleUnfollow}
          />
        </div>
      )}
    </div>
  );
}
