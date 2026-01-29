'use client';

import { ChallengeMode, ChallengeType, SplitType } from '@blert/common';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { PlayerWithCurrentUsername, TiedTeam } from '@/actions/challenge';
import Card from '@/components/card';
import { challengeUrl, queryString, UrlParams } from '@/utils/url';

import styles from './style.module.scss';

export type Rank = {
  uuid: string;
  date: Date;
  party: PlayerWithCurrentUsername[];
  value: number | string;
  tieCount?: number;
  tiedTeams?: TiedTeam[];
  splitType?: SplitType;
  scale?: number;
  ticks?: number;
};

export type LeaderboardProps = {
  challengeType: ChallengeType;
  mode: ChallengeMode;
  ranks: Rank[];
  title: string;
};

type TieBadgeProps = {
  rank: Rank;
  rankIndex: number;
  challengeType: ChallengeType;
  mode: ChallengeMode;
};

const VIEWPORT_PADDING = 8;

function TieBadge({ rank, rankIndex, challengeType, mode }: TieBadgeProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    right: number;
    openAbove: boolean;
    maxWidth: number;
  } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { tieCount, tiedTeams, splitType, scale, ticks } = rank;

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      return;
    }

    const button = buttonRef.current;
    const rect = button.getBoundingClientRect();

    // Check available space below vs above
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const popoverHeight = 280; // Approximate max height of popover

    const openAbove = spaceBelow < popoverHeight && spaceAbove > spaceBelow;

    let top: number;
    if (openAbove) {
      top = rect.top + window.scrollY;
    } else {
      top = rect.bottom + window.scrollY + VIEWPORT_PADDING;
    }

    // Position from right edge of viewport to align popover's right edge with button's right edge
    let right = window.innerWidth - rect.right;

    // Calculate max width that fits on screen
    const maxPopoverWidth = Math.min(
      400,
      window.innerWidth - VIEWPORT_PADDING * 2,
    );

    // Ensure popover doesn't go off left edge
    if (window.innerWidth - right - maxPopoverWidth < VIEWPORT_PADDING) {
      right = window.innerWidth - maxPopoverWidth - VIEWPORT_PADDING;
    }

    setPosition({ top, right, openAbove, maxWidth: maxPopoverWidth });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (tieCount === undefined || tieCount === 0) {
    return null;
  }

  const displayedTeams = tiedTeams ?? [];
  const remainingCount = tieCount - displayedTeams.length;
  let searchUrl: string | null = null;

  if (splitType !== undefined && ticks !== undefined && scale !== undefined) {
    const params: UrlParams = {
      scale,
      [`split:${splitType}`]: `eq${ticks}`,
      sort: '+startTime',
      type: challengeType,
    };
    if (challengeType === ChallengeType.TOB) {
      params.mode = mode;
    }
    searchUrl = `/search/challenges?${queryString(params)}`;
  }

  const portalRoot =
    typeof document !== 'undefined'
      ? document.getElementById('portal-root')
      : null;

  const popover =
    open && position !== null ? (
      <div
        ref={popoverRef}
        className={`${styles.tiePopover} ${position.openAbove ? styles.openAbove : ''}`}
        style={{
          position: 'absolute',
          top: position.openAbove ? undefined : position.top,
          bottom: position.openAbove
            ? window.innerHeight - position.top
            : undefined,
          right: position.right,
          maxWidth: position.maxWidth,
        }}
      >
        <div className={styles.popoverHeader}>
          <i className="fas fa-users" />
          <span>
            {tieCount} other challenge{tieCount !== 1 ? 's' : ''} with this time
          </span>
        </div>
        <div className={styles.popoverList}>
          {displayedTeams.map((team) => (
            <Link
              key={team.uuid}
              href={challengeUrl(challengeType, team.uuid)}
              className={styles.popoverTeam}
              onClick={() => setOpen(false)}
            >
              <span className={styles.teamRank}>T{rankIndex + 1}</span>
              <span className={styles.teamParty}>
                {team.party.map((p) => p.currentUsername).join(', ')}
              </span>
              <span className={styles.teamDate}>
                {new Date(team.date).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'numeric',
                  day: 'numeric',
                })}
              </span>
            </Link>
          ))}
        </div>
        {remainingCount > 0 && searchUrl !== null && (
          <Link
            href={searchUrl}
            className={styles.popoverViewAll}
            onClick={() => setOpen(false)}
          >
            View all tied challenges
            <i className="fas fa-arrow-right" />
          </Link>
        )}
      </div>
    ) : null;

  return (
    <div className={styles.tieContainer}>
      <button
        ref={buttonRef}
        className={styles.tieBadge}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <i className="fas fa-users" />+{tieCount}
      </button>

      {portalRoot !== null ? createPortal(popover, portalRoot) : popover}
    </div>
  );
}

export default function Leaderboard({
  challengeType,
  mode,
  ranks,
  title,
}: LeaderboardProps) {
  return (
    <Card header={{ title }} className={styles.boardCard}>
      <div className={styles.board}>
        {ranks.map((rank, i) => (
          <div key={i} className={styles.entry}>
            <Link
              className={styles.entryLink}
              href={challengeUrl(challengeType, rank.uuid)}
            >
              <div className={styles.rank}>
                {i <= 2 && (
                  <span
                    className={`${styles.medal} ${
                      i === 0
                        ? styles.gold
                        : i === 1
                          ? styles.silver
                          : i === 2
                            ? styles.bronze
                            : ''
                    }`}
                  >
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                  </span>
                )}
                {i + 1}
              </div>
              <div className={styles.wrapper}>
                <span className={styles.time}>{rank.value}</span>
                <div className={styles.party}>
                  {rank.party.map((p) => p.currentUsername).join(', ')}
                </div>
              </div>
            </Link>
            <div className={styles.metaColumn}>
              <span className={styles.date}>
                {new Date(rank.date).toLocaleDateString(undefined, {
                  year: 'numeric',
                  month: 'numeric',
                  day: 'numeric',
                })}
              </span>
              <TieBadge
                rank={rank}
                rankIndex={i}
                challengeType={challengeType}
                mode={mode}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
