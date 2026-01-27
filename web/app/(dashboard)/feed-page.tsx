'use client';

import { useCallback, useEffect, useState } from 'react';

import { FeedItem, FollowedPlayer, SuggestedPlayer } from '@/actions/feed';
import Card from '@/components/card';

import Feed from './feed/feed';
import EmptyFeed from './feed/empty-feed';
import FollowManager from './feed/follow-manager';
import PlayerPicker from './feed/player-picker';

import styles from './style.module.scss';

const SCROLL_THRESHOLD_FOR_REFRESH = 500;
const PICKER_PLAYER_COUNT = 8;
const PICKER_TTL_MS = 15 * 60 * 1000;

function pickerStorageKey(userId: number): string {
  return `blert:picker-suggestions:${userId}`;
}

type StoredPickerSuggestions = {
  suggestions: SuggestedPlayer[];
  storedAt: number;
};

function loadPickerSuggestions(userId: number): SuggestedPlayer[] | null {
  try {
    const stored = localStorage.getItem(pickerStorageKey(userId));
    if (stored === null) {
      return null;
    }
    const parsed = JSON.parse(stored) as StoredPickerSuggestions;
    if (Date.now() - parsed.storedAt > PICKER_TTL_MS) {
      localStorage.removeItem(pickerStorageKey(userId));
      return null;
    }
    return parsed.suggestions;
  } catch {
    return null;
  }
}

function savePickerSuggestions(
  userId: number,
  suggestions: SuggestedPlayer[],
): void {
  try {
    const data: StoredPickerSuggestions = {
      suggestions,
      storedAt: Date.now(),
    };
    localStorage.setItem(pickerStorageKey(userId), JSON.stringify(data));
  } catch {
    // Ignore storage errors.
  }
}

function clearPickerSuggestions(userId: number): void {
  try {
    localStorage.removeItem(pickerStorageKey(userId));
  } catch {
    // Ignore storage errors.
  }
}

type FeedPageProps = {
  userId: number;
  initialFeed: FeedItem[];
  initialOlderCursor: string | null;
  initialNewerCursor: string | null;
  following: FollowedPlayer[];
  followingCount: number;
  suggestions: SuggestedPlayer[];
};

export default function FeedPage({
  initialFeed,
  initialOlderCursor,
  initialNewerCursor,
  following,
  followingCount,
  suggestions,
  userId,
}: FeedPageProps) {
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const [pickerSuggestions, setPickerSuggestions] = useState<
    SuggestedPlayer[] | null
  >(null);

  const [localFollowing, setLocalFollowing] = useState(following);
  const [localFollowingCount, setLocalFollowingCount] =
    useState(followingCount);
  const [feedRefetchKey, setFeedRefetchKey] = useState(0);

  // On mount, load persisted picker suggestions or save current ones.
  useEffect(() => {
    if (following.length > 0) {
      clearPickerSuggestions(userId);
      setPickerSuggestions([]);
      return;
    }

    const stored = loadPickerSuggestions(userId);
    if (stored !== null && stored.length > 0) {
      setPickerSuggestions(stored);
    } else if (suggestions.length > 0) {
      const toStore = suggestions.slice(0, PICKER_PLAYER_COUNT);
      savePickerSuggestions(userId, toStore);
      setPickerSuggestions(toStore);
    } else {
      setPickerSuggestions([]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showPicker =
    localFollowing.length === 0 &&
    pickerSuggestions !== null &&
    pickerSuggestions.length > 0 &&
    !pickerDismissed;

  const pickerLoading =
    localFollowing.length === 0 && pickerSuggestions === null;

  const handlePlayerFollowed = useCallback((player: FollowedPlayer) => {
    setLocalFollowing((prev) => [player, ...prev]);
    setLocalFollowingCount((c) => c + 1);
    if (window.scrollY < SCROLL_THRESHOLD_FOR_REFRESH) {
      setFeedRefetchKey((k) => k + 1);
    }
  }, []);

  const handlePlayerUnfollowed = useCallback((playerId: number) => {
    setLocalFollowing((prev) => prev.filter((p) => p.id !== playerId));
    setLocalFollowingCount((c) => c - 1);
    if (window.scrollY < SCROLL_THRESHOLD_FOR_REFRESH) {
      setFeedRefetchKey((k) => k + 1);
    }
  }, []);

  const handlePickerComplete = useCallback(
    (followedPlayers: FollowedPlayer[]) => {
      clearPickerSuggestions(userId);
      setPickerDismissed(true);

      if (followedPlayers.length > 0) {
        setLocalFollowing((prev) => [...followedPlayers, ...prev]);
        setLocalFollowingCount((c) => c + followedPlayers.length);
        setFeedRefetchKey((k) => k + 1);
      }
    },
    [userId],
  );

  return (
    <div className={styles.feedPage}>
      <h2>Your Feed</h2>
      <div className={styles.content}>
        <main className={styles.main}>
          {showPicker ? (
            <div className={styles.pickerContainer}>
              <EmptyFeed reason="no-follows" />
              <Card>
                <PlayerPicker
                  suggestions={pickerSuggestions}
                  onComplete={handlePickerComplete}
                />
              </Card>
            </div>
          ) : (
            <Feed
              initialFeed={initialFeed}
              initialOlderCursor={initialOlderCursor}
              initialNewerCursor={initialNewerCursor}
              following={localFollowing}
              refetchKey={feedRefetchKey}
            />
          )}
        </main>
        <aside className={styles.sidebar}>
          <FollowManager
            initialFollowing={localFollowing}
            initialFollowingCount={localFollowingCount}
            initialSuggestions={showPicker || pickerLoading ? [] : suggestions}
            onPlayerFollowed={handlePlayerFollowed}
            onPlayerUnfollowed={handlePlayerUnfollowed}
          />
        </aside>
      </div>
    </div>
  );
}
