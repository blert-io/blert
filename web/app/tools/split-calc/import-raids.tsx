'use client';

import { ChallengeMode, ChallengeStatus, ChallengeType } from '@blert/common';
import { useEffect, useRef, useState } from 'react';

import { ChallengeOverview } from '@/actions/challenge';
import { getConnectedPlayers } from '@/actions/users';
import { scaleNameAndColor } from '@/utils/challenge';
import { timeAgo } from '@/utils/time';
import { queryString, UrlParams } from '@/utils/url';

import { TOB_MODES, TOB_ROOMS } from './types';

function modeName(mode: ChallengeMode): string {
  return TOB_MODES.find((m) => m.mode === mode)?.label ?? 'Unknown';
}

import styles from './style.module.scss';

const SPLIT_EXTRA_FIELDS = TOB_ROOMS.map((r) => `splits:${r.splitType}`);

type ImportRaidsProps = {
  mode: ChallengeMode;
  scale: number;
  onImport: (challenge: ChallengeOverview) => void;
};

async function fetchChallenges(
  params: UrlParams,
): Promise<ChallengeOverview[]> {
  const qs = queryString(params);
  const res = await fetch(`/api/v1/challenges?${qs}`);
  if (!res.ok) {
    return [];
  }
  return res.json() as Promise<ChallengeOverview[]>;
}

export function ImportRaids({ mode, scale, onImport }: ImportRaidsProps) {
  const [open, setOpen] = useState(false);
  const [raids, setRaids] = useState<ChallengeOverview[]>([]);
  const [loading, setLoading] = useState(false);
  const [userRaid, setUserRaid] = useState<ChallengeOverview | null>(null);
  const [userRaidLoading, setUserRaidLoading] = useState(true);
  const connectedPlayersRef = useRef<string[]>([]);
  const raidsRequestIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Try to detect user's active raid on mount.
  useEffect(() => {
    getConnectedPlayers()
      .then((players) => {
        const usernames = players.map((p) => p.username);
        connectedPlayersRef.current = usernames.map((u) => u.toLowerCase());

        return Promise.all(
          usernames.map((username) =>
            fetchChallenges({
              type: ChallengeType.TOB,
              status: ChallengeStatus.IN_PROGRESS,
              party: username,
              limit: 1,
              extraFields: SPLIT_EXTRA_FIELDS,
            }),
          ),
        );
      })
      .then((results) => {
        const raid = results.flat()[0];
        if (raid !== undefined) {
          setUserRaid(raid);
        }
      })
      .catch(() => {
        // Silently ignore.
      })
      .finally(() => {
        setUserRaidLoading(false);
      });
  }, []);

  // Fetch active raids when the panel opens.
  useEffect(() => {
    if (!open) {
      setLoading(false);
      return;
    }

    const requestId = raidsRequestIdRef.current + 1;
    raidsRequestIdRef.current = requestId;
    let cancelled = false;

    setLoading(true);
    fetchChallenges({
      type: ChallengeType.TOB,
      status: ChallengeStatus.IN_PROGRESS,
      mode: mode,
      scale: scale,
      limit: 10,
      extraFields: SPLIT_EXTRA_FIELDS,
    })
      .then((results) => {
        if (cancelled || raidsRequestIdRef.current !== requestId) {
          return;
        }
        setRaids(results);
      })
      .catch(() => {
        if (cancelled || raidsRequestIdRef.current !== requestId) {
          return;
        }
        setRaids([]);
      })
      .finally(() => {
        if (!cancelled && raidsRequestIdRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, mode, scale]);

  // Close on outside click.
  useEffect(() => {
    if (!open) {
      return;
    }
    function handler(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function completedRooms(challenge: ChallengeOverview): number {
    return TOB_ROOMS.filter((r) => {
      const split = challenge.splits?.[r.splitType];
      return split !== undefined && split.ticks > 0;
    }).length;
  }

  function handleImport(challenge: ChallengeOverview) {
    onImport(challenge);
    setOpen(false);
  }

  const browseRaids = userRaid
    ? raids.filter((r) => r.uuid !== userRaid.uuid)
    : raids;

  const showUserRaid = userRaid !== null && !userRaidLoading;

  return (
    <div className={styles.importContainer} ref={containerRef}>
      <button
        className={styles.clearButton}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <i className="fas fa-file-import" /> Import
        {showUserRaid && <span className={styles.importDot} />}
      </button>
      {open && (
        <div className={styles.importPanel}>
          {showUserRaid && (
            <>
              <div className={styles.importSectionLabel}>Your active raid</div>
              <button
                className={`${styles.importItem} ${styles.importItemUser}`}
                onClick={() => handleImport(userRaid)}
                type="button"
              >
                <span className={styles.importParty}>
                  {userRaid.party.map((p) => p.username).join(', ')}
                </span>
                <span className={styles.importMeta}>
                  {completedRooms(userRaid)}/{TOB_ROOMS.length} rooms •{' '}
                  {timeAgo(userRaid.startTime)}
                </span>
              </button>
            </>
          )}
          <div className={styles.importSectionLabel}>
            Active {scaleNameAndColor(scale)[0]} {modeName(mode)} raids
          </div>
          {loading ? (
            <div className={styles.importEmpty}>
              <i className="fas fa-spinner fa-spin" /> Loading&hellip;
            </div>
          ) : browseRaids.length === 0 ? (
            <div className={styles.importEmpty}>No active raids found</div>
          ) : (
            browseRaids.map((raid) => (
              <button
                key={raid.uuid}
                className={styles.importItem}
                onClick={() => handleImport(raid)}
                type="button"
              >
                <span className={styles.importParty}>
                  {raid.party.map((p) => p.username).join(', ')}
                </span>
                <span className={styles.importMeta}>
                  {completedRooms(raid)}/{TOB_ROOMS.length} rooms •{' '}
                  {timeAgo(raid.startTime)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
