'use client';

import { challengeName, ChallengeType } from '@blert/common';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import { PlayerWithStats } from '@/actions/challenge';
import Tooltip from '@/components/tooltip';
import { challengeLogo } from '@/logo';
import { ApiResponse } from '@/utils/api';

import { PLAYER_LINK_TOOLTIP_ID } from './player-link';
import styles from './style.module.scss';

const TOOLTIP_DELAY_MS = 750;

const MAX_CACHE_SIZE = 50;
const playerCache = new Map<string, PlayerWithStats>();

function cachePlayer(username: string, data: PlayerWithStats) {
  const key = username.toLowerCase();
  if (playerCache.size >= MAX_CACHE_SIZE) {
    const firstKey = playerCache.keys().next().value;
    if (firstKey !== undefined) {
      playerCache.delete(firstKey);
    }
  }
  playerCache.set(key, data);
}

function getCachedPlayer(username: string): PlayerWithStats | undefined {
  return playerCache.get(username.toLowerCase());
}

type TooltipState = {
  loading: boolean;
  error: boolean;
  data: PlayerWithStats | null;
};

function PlayerTooltipRenderer({
  activeAnchor,
}: {
  activeAnchor: HTMLElement | null;
}) {
  const [state, setState] = useState<TooltipState>({
    loading: false,
    error: false,
    data: null,
  });

  const username = activeAnchor?.dataset.tooltipUsername;

  useEffect(() => {
    if (!username) {
      setState({ loading: false, error: false, data: null });
      return;
    }

    const cached = getCachedPlayer(username);
    if (cached) {
      setState({ loading: false, error: false, data: cached });
      return;
    }

    const abortController = new AbortController();

    setState({ loading: true, error: false, data: null });

    fetch(`/api/v1/players/${encodeURIComponent(username)}`, {
      signal: abortController.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Player not found');
        }
        return response.json();
      })
      .then((json: ApiResponse<PlayerWithStats>) => {
        const data: PlayerWithStats = {
          ...json,
          firstRecorded: new Date(json.firstRecorded),
        };
        cachePlayer(username, data);
        setState({ loading: false, error: false, data });
      })
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        setState({ loading: false, error: true, data: null });
      });

    return () => {
      abortController.abort();
    };
  }, [username]);

  if (!username) {
    return null;
  }

  if (state.loading) {
    return (
      <div className={styles.loading}>
        <i className="fas fa-spinner fa-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  if (state.error || state.data === null) {
    return <div className={styles.error}>Player not found</div>;
  }

  const { data } = state;

  return (
    <div className={styles.tooltipContent}>
      <div className={styles.tooltipHeader}>
        <i className="fas fa-user" />
        <span className={styles.username}>{data.username}</span>
      </div>
      <div className={styles.statsGrid}>
        <div className={styles.stat}>
          <span className={styles.label}>Recordings</span>
          <span className={styles.value}>{data.totalRecordings}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.label}>First Recorded</span>
          <span className={styles.value}>
            {data.firstRecorded.toLocaleDateString()}
          </span>
        </div>
      </div>
      <div className={styles.completionsGrid}>
        <CompletionStat
          challengeType={ChallengeType.TOB}
          count={data.stats.tobCompletions}
        />
        <CompletionStat
          challengeType={ChallengeType.COLOSSEUM}
          count={data.stats.colosseumCompletions}
        />
        <CompletionStat
          challengeType={ChallengeType.INFERNO}
          count={data.stats.infernoCompletions}
        />
        <CompletionStat
          challengeType={ChallengeType.MOKHAIOTL}
          count={data.stats.mokhaiotlCompletions}
        />
      </div>
    </div>
  );
}

type CompletionStatProps = {
  challengeType: ChallengeType;
  count: number;
};

function CompletionStat({ challengeType, count }: CompletionStatProps) {
  return (
    <div className={styles.completionStat}>
      <Image
        className={styles.challengeIcon}
        src={challengeLogo(challengeType)}
        alt={challengeName(challengeType)}
        width={20}
        height={20}
      />
      <span className={styles.count}>{count}</span>
    </div>
  );
}

export function PlayerLinkTooltip() {
  return (
    <Tooltip
      tooltipId={PLAYER_LINK_TOOLTIP_ID}
      delayShow={TOOLTIP_DELAY_MS}
      maxWidth={300}
      render={PlayerTooltipRenderer}
    />
  );
}
