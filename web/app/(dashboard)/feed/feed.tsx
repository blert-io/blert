'use client';

import { SessionStatus } from '@blert/common';
import { useCallback, useEffect, useRef, useState } from 'react';

import { SessionStatusUpdate } from '@/actions/challenge';
import { FeedItem, FeedResult, FollowedPlayer } from '@/actions/feed';

import EmptyFeed from './empty-feed';
import NameChangeFeedCard from './name-change-feed-card';
import NewItemsBanner from './new-items-banner';
import PbFeedCard from './pb-feed-card';
import SessionFeedCard from './session-feed-card';

import styles from './feed.module.scss';

const POLL_INTERVAL_MS = 30_000;
const LOAD_MORE_SIZE = 20;
const SCROLL_THRESHOLD_FOR_AUTO_MERGE = 200;

/**
 * Unique ID for a feed item for deduplication.
 */
function getFeedItemId(item: FeedItem): string {
  return `${item.type}:${item.id}`;
}

/**
 * Parse string dates in feed items from JSON.
 */
function parseFeedItemDates(items: FeedItem[]): FeedItem[] {
  return items.map((item) => {
    if (item.type === 'session') {
      return {
        ...item,
        timestamp: new Date(item.timestamp),
        session: {
          ...item.session,
          startTime: new Date(item.session.startTime),
          endTime: item.session.endTime ? new Date(item.session.endTime) : null,
          challenges: item.session.challenges.map((c) => ({
            ...c,
            startTime: new Date(c.startTime),
          })),
        },
      };
    } else {
      return {
        ...item,
        timestamp: new Date(item.timestamp),
      };
    }
  });
}

type FeedCursor = {
  cursor: string;
  direction: 'older' | 'newer';
};

async function fetchSessionStatuses(
  uuids: string[],
  signal?: AbortSignal,
): Promise<SessionStatusUpdate[]> {
  if (uuids.length === 0) {
    return [];
  }

  const response = await fetch(
    `/api/v1/sessions/status?uuids=${uuids.join(',')}`,
    { cache: 'no-store', signal },
  );
  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as SessionStatusUpdate[];
  return data.map((s) => ({
    ...s,
    endTime: s.endTime !== null ? new Date(s.endTime) : null,
  }));
}

async function fetchFeed(
  limit: number,
  cursor?: FeedCursor,
  signal?: AbortSignal,
): Promise<FeedResult | null> {
  const params = new URLSearchParams();
  params.set('limit', limit.toString());
  if (cursor !== undefined) {
    params.set('cursor', cursor.cursor);
    params.set('direction', cursor.direction);
  }

  const response = await fetch(`/api/feed?${params.toString()}`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    return null;
  }

  try {
    const data = (await response.json()) as FeedResult;
    return {
      items: parseFeedItemDates(data.items),
      olderCursor: data.olderCursor,
      newerCursor: data.newerCursor,
    };
  } catch (error) {
    console.error('Failed to fetch feed:', error);
    return null;
  }
}

type FeedProps = {
  initialFeed: FeedItem[];
  initialOlderCursor: string | null;
  initialNewerCursor: string | null;
  following: FollowedPlayer[];
  refetchKey?: number;
};

function FeedItemSkeleton() {
  return (
    <div className={styles.feedItem}>
      <div className={styles.skeletonHeader}>
        <div className={`${styles.skeleton} ${styles.skeletonIcon}`} />
        <div className={`${styles.skeleton} ${styles.skeletonTitle}`} />
        <div className={`${styles.skeleton} ${styles.skeletonTime}`} />
      </div>
      <div className={styles.skeletonBody}>
        <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
        <div className={`${styles.skeleton} ${styles.skeletonLineShort}`} />
      </div>
    </div>
  );
}

export default function Feed({
  initialFeed,
  initialOlderCursor,
  initialNewerCursor,
  following,
  refetchKey = 0,
}: FeedProps) {
  const [items, setItems] = useState<FeedItem[]>(initialFeed);
  const [pendingItems, setPendingItems] = useState<FeedItem[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(
    initialOlderCursor,
  );
  const [newerCursor, setNewerCursor] = useState<string | null>(
    initialNewerCursor,
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialOlderCursor !== null);
  const [loadError, setLoadError] = useState(false);
  const [isNearTop, setIsNearTop] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Tracks all seen item IDs for deduplication in polling.
  const seenIdsRef = useRef<Set<string>>(
    new Set(initialFeed.map(getFeedItemId)),
  );

  useEffect(() => {
    setItems(initialFeed);
    setPendingItems([]);
    setOlderCursor(initialOlderCursor);
    setNewerCursor(initialNewerCursor);
    setHasMore(initialOlderCursor !== null);
    setLoadError(false);
    seenIdsRef.current = new Set(initialFeed.map(getFeedItemId));
  }, [initialFeed, initialOlderCursor, initialNewerCursor]);

  useEffect(() => {
    if (refetchKey === 0) {
      return;
    }

    const refetch = async () => {
      try {
        const result = await fetchFeed(LOAD_MORE_SIZE);
        if (result === null) {
          return;
        }

        seenIdsRef.current = new Set(result.items.map(getFeedItemId));
        setItems(result.items);
        setPendingItems([]);
        setOlderCursor(result.olderCursor);
        setNewerCursor(result.newerCursor);
        setHasMore(result.olderCursor !== null);
        setLoadError(false);
      } catch (error) {
        console.error('Failed to refetch feed:', error);
      }
    };

    void refetch();
  }, [refetchKey]);

  useEffect(() => {
    const handleScroll = () => {
      setIsNearTop(window.scrollY < SCROLL_THRESHOLD_FOR_AUTO_MERGE);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-merge pending items when user is near the top.
  useEffect(() => {
    if (isNearTop && pendingItems.length > 0) {
      setItems((prev) => [...pendingItems, ...prev]);
      setPendingItems([]);
    }
  }, [isNearTop, pendingItems]);

  const pollCursorRef = useRef<string | null>(newerCursor);
  useEffect(() => {
    pollCursorRef.current = newerCursor;
  }, [newerCursor]);
  const pollInFlight = useRef(false);

  // Track live session UUIDs for status polling.
  const liveSessionUuidsRef = useRef<string[]>([]);
  useEffect(() => {
    const uuids: string[] = [];
    for (const item of items) {
      if (
        item.type === 'session' &&
        item.session.status === SessionStatus.ACTIVE
      ) {
        uuids.push(item.session.uuid);
      }
    }
    liveSessionUuidsRef.current = uuids;
  }, [items]);

  const hasFollows = following.length > 0;

  // Poll for new feed items.
  useEffect(() => {
    if (!hasFollows) {
      return;
    }

    const abortController = new AbortController();
    let timeoutId: number | null = null;

    const poll = async () => {
      if (pollInFlight.current) {
        return;
      }
      pollInFlight.current = true;

      try {
        const feedPromise =
          pollCursorRef.current !== null
            ? fetchFeed(
                50,
                { cursor: pollCursorRef.current, direction: 'newer' },
                abortController.signal,
              )
            : fetchFeed(50, undefined, abortController.signal);

        const liveUuids = liveSessionUuidsRef.current;
        const statusPromise =
          liveUuids.length > 0
            ? fetchSessionStatuses(liveUuids, abortController.signal)
            : Promise.resolve([]);

        const [result, statuses] = await Promise.all([
          feedPromise,
          statusPromise,
        ]);

        if (abortController.signal.aborted) {
          return;
        }

        // Update ended sessions.
        if (statuses.length > 0) {
          const statusByUuid = new Map(statuses.map((s) => [s.uuid, s]));
          setItems((prev) => {
            const next = [];

            for (const item of prev) {
              if (item.type !== 'session') {
                next.push(item);
                continue;
              }
              const update = statusByUuid.get(item.session.uuid);
              if (
                update === undefined ||
                update.status === item.session.status
              ) {
                next.push(item);
                continue;
              }

              if (update.status === SessionStatus.HIDDEN) {
                continue;
              }

              next.push({
                ...item,
                session: {
                  ...item.session,
                  status: update.status,
                  endTime: update.endTime,
                },
              });
            }
            return next;
          });
        }

        if (result === null) {
          return;
        }

        if (result.newerCursor !== null) {
          setNewerCursor(result.newerCursor);
        }

        if (result.items.length > 0) {
          const newItems = result.items.filter((item) => {
            const id = getFeedItemId(item);
            if (seenIdsRef.current.has(id)) {
              return false;
            }
            seenIdsRef.current.add(id);
            return true;
          });

          if (newItems.length > 0) {
            setPendingItems((prev) => [...newItems, ...prev]);
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to poll for new feed items:', error);
      } finally {
        pollInFlight.current = false;
        if (!abortController.signal.aborted) {
          timeoutId = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Clear pending timeout and poll immediately when tab becomes visible.
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (!pollInFlight.current) {
          void poll();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    void poll();

    return () => {
      abortController.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      pollInFlight.current = false;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [hasFollows]);

  const loadPendingItems = useCallback(() => {
    setItems((prev) => [...pendingItems, ...prev]);
    setPendingItems([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pendingItems]);

  const loadMoreInFlight = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadMoreInFlight.current || !hasMore || olderCursor === null) {
      return;
    }

    loadMoreInFlight.current = true;
    setIsLoadingMore(true);
    setLoadError(false);

    try {
      const result = await fetchFeed(LOAD_MORE_SIZE, {
        cursor: olderCursor,
        direction: 'older',
      });
      if (result === null) {
        setLoadError(true);
        return;
      }

      if (result.olderCursor === null) {
        setHasMore(false);
      } else {
        setOlderCursor(result.olderCursor);
      }

      if (result.items.length > 0) {
        const newItems = result.items.filter((item) => {
          const id = getFeedItemId(item);
          if (seenIdsRef.current.has(id)) {
            return false;
          }
          seenIdsRef.current.add(id);
          return true;
        });
        if (newItems.length > 0) {
          setItems((prev) => [...prev, ...newItems]);
        }
      }
    } catch (error) {
      console.error('Failed to load more feed items:', error);
      setLoadError(true);
    } finally {
      loadMoreInFlight.current = false;
      setIsLoadingMore(false);
    }
  }, [hasMore, olderCursor]);

  // Infinite scroll.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null || !hasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: '100px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  if (!hasFollows) {
    return <EmptyFeed reason="no-follows" />;
  }

  if (items.length === 0 && pendingItems.length === 0) {
    return <EmptyFeed reason="no-activity" />;
  }

  return (
    <div className={styles.feed}>
      {pendingItems.length > 0 && !isNearTop && (
        <NewItemsBanner
          count={pendingItems.length}
          onClick={loadPendingItems}
        />
      )}

      <div className={styles.feedList}>
        {items.map((item) => {
          const key = getFeedItemId(item);
          switch (item.type) {
            case 'session':
              return <SessionFeedCard key={key} item={item} />;
            case 'personal_best':
              return <PbFeedCard key={key} item={item} />;
            case 'name_change':
              return <NameChangeFeedCard key={key} item={item} />;
          }
        })}
      </div>

      {/* Sentinel element for infinite scroll. */}
      {hasMore && !loadError && (
        <div ref={sentinelRef} className={styles.sentinel} />
      )}

      {loadError && hasMore && (
        <div className={styles.loadMore}>
          <button
            onClick={() => void loadMore()}
            disabled={isLoadingMore}
            className={styles.loadMoreButton}
          >
            <i className="fas fa-exclamation-triangle" />
            Failed to load. Tap to retry.
          </button>
        </div>
      )}

      {isLoadingMore && (
        <div className={styles.loadingSkeletons}>
          <FeedItemSkeleton />
          <FeedItemSkeleton />
          <FeedItemSkeleton />
        </div>
      )}
    </div>
  );
}
