'use client';

import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SessionStatus,
} from '@blert/common';
import Link from 'next/link';
import { useDeferredValue, useEffect, useState } from 'react';
import TimeAgo from 'react-timeago';

import { ChallengeOverview, SessionWithChallenges } from '@/actions/challenge';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { useClientOnly } from '@/hooks/client-only';
import {
  modeNameAndColor,
  statusNameAndColor,
  scaleNameAndColor,
} from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { formatDuration } from '@/utils/time';
import { challengeUrl, queryString } from '@/utils/url';

import styles from './style.module.scss';

export type SessionHistoryProps = {
  count: number;
  initialSessions?: SessionWithChallenges[];
  mode?: ChallengeMode;
  type?: ChallengeType;
  scale?: number;
  status?: SessionStatus | SessionStatus[];
  username?: string;
};

function ChallengeItem({
  challenge,
  challengeIndex,
  icon,
  groupName,
  totalChallenges,
}: {
  challenge: ChallengeOverview;
  challengeIndex: number;
  icon?: React.ReactNode;
  groupName: string;
  totalChallenges: number;
}) {
  const isClient = useClientOnly();
  const [statusString, statusColor] = statusNameAndColor(
    challenge.status,
    challenge.stage,
  );
  const [modeString, modeColor] = modeNameAndColor(
    challenge.type,
    challenge.mode,
  );

  const getStatusIcon = (status: ChallengeStatus) => {
    switch (status) {
      case ChallengeStatus.COMPLETED:
        return 'fa-check';
      case ChallengeStatus.WIPED:
        return 'fa-x';
      case ChallengeStatus.RESET:
        return 'fa-undo';
      case ChallengeStatus.IN_PROGRESS:
        return 'fa-ellipsis';
      default:
        return 'fa-x';
    }
  };

  return (
    <Link
      href={challengeUrl(challenge.type, challenge.uuid)}
      className={styles.challengeItem}
    >
      <div className={styles.challengeHeader}>
        <span className={styles.challengeIndex}>
          {groupName} {challengeIndex} of {totalChallenges}
        </span>
        {icon}
      </div>

      <div className={styles.challengeDetails}>
        <div className={styles.challengeDetail} style={{ color: modeColor }}>
          <i className="fas fa-trophy" style={{ color: modeColor }} />
          <span>{modeString}</span>
        </div>

        <div className={styles.challengeDetail} style={{ color: statusColor }}>
          <i
            className={`fas ${getStatusIcon(challenge.status)}`}
            style={{ color: statusColor }}
          />
          <span>{statusString}</span>
        </div>

        <div className={styles.challengeDetail}>
          <i className="fas fa-hourglass" />
          <span>{ticksToFormattedSeconds(challenge.challengeTicks)}</span>
        </div>

        <div className={styles.challengeDetail}>
          <i className="fas fa-clock" />
          {isClient && <TimeAgo date={challenge.startTime} />}
        </div>

        <div className={styles.challengeDetail}>
          <i className="fas fa-skull" />
          <span>
            {challenge.totalDeaths} Death
            {challenge.totalDeaths !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </Link>
  );
}

function SessionCard({
  session,
  isExpanded,
  onToggle,
}: {
  session: SessionWithChallenges;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isClient = useClientOnly();

  if (session.challenges.length === 0) {
    return null;
  }

  const totalChallenges = session.challenges.length;
  const completedChallenges = session.challenges.filter(
    (c) => c.status === ChallengeStatus.COMPLETED,
  ).length;
  const totalDeaths = session.challenges.reduce(
    (sum, c) => sum + c.totalDeaths,
    0,
  );
  const completionRate =
    totalChallenges > 0
      ? Math.round((completedChallenges / totalChallenges) * 100)
      : 0;

  const end = session.endTime ?? new Date();
  const sessionDuration = formatDuration(
    end.getTime() - session.startTime.getTime(),
  );

  const isActiveSession = session.status === SessionStatus.ACTIVE;

  const timeReference = isActiveSession ? session.startTime : session.endTime;
  const timeText = isActiveSession ? 'Started' : 'Finished';

  const groupName = [
    ChallengeType.TOB,
    ChallengeType.TOA,
    ChallengeType.COX,
  ].includes(session.challengeType)
    ? 'Raid'
    : 'Run';

  // Highlight the fastest completed challenge only if there are multiple
  // challenges in the session.
  let fastestChallenge: ChallengeOverview | null = null;
  if (session.challenges.length > 1) {
    fastestChallenge = session.challenges.reduce<ChallengeOverview | null>(
      (fastest, challenge) => {
        if (challenge.status !== ChallengeStatus.COMPLETED) {
          return fastest;
        }
        if (fastest === null) {
          return challenge;
        }
        return challenge.challengeTicks < fastest.challengeTicks
          ? challenge
          : fastest;
      },
      null,
    );
  }

  const [latestStatus, latestColor] = statusNameAndColor(
    session.challenges[0].status,
    session.challenges[0].stage,
  );

  return (
    <div
      className={`${styles.sessionCard} ${isActiveSession ? styles.activeSession : ''}`}
    >
      <div className={styles.sessionHeader} onClick={onToggle}>
        <div className={styles.sessionTitle}>
          <div className={styles.sessionInfo}>
            <h3 className={styles.sessionName}>{session.party.join(', ')}</h3>
            <div className={styles.sessionMeta}>
              {isActiveSession && (
                <>
                  <span className={styles.liveIndicator}>
                    <span className={styles.pulsingDot} />
                    Live
                  </span>
                  <span className={styles.separator}>•</span>
                </>
              )}
              <span>
                <i className="fas fa-clock" />
                {timeText}{' '}
                {isClient && timeReference && <TimeAgo date={timeReference} />}
              </span>
              <span className={styles.separator}>•</span>
              <span>
                {
                  modeNameAndColor(
                    session.challengeType,
                    session.challengeMode,
                  )[0]
                }
              </span>
              <span className={styles.separator}>•</span>
              <span>{scaleNameAndColor(session.scale)[0]}</span>
            </div>
          </div>
          <div className={styles.sessionActions}>
            <Link
              href={`/sessions/${session.uuid}`}
              className={styles.viewSessionButton}
              onClick={(e) => e.stopPropagation()}
              data-tooltip-id={GLOBAL_TOOLTIP_ID}
              data-tooltip-content="View session details"
            >
              <i className="fas fa-external-link-alt" />
            </Link>
            <button className={styles.expandButton}>
              <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'}`} />
            </button>
          </div>
        </div>

        <div className={styles.sessionStats}>
          <div className={styles.stat}>
            <i className="fas fa-list-ol" />
            <span>
              {totalChallenges} {groupName.toLowerCase()}
              {totalChallenges !== 1 ? 's' : ''}
            </span>
          </div>

          <div className={styles.stat}>
            <i className="fas fa-flag-checkered" />
            <span>Latest:</span>
            <span style={{ color: latestColor }}>{latestStatus}</span>
          </div>

          {sessionDuration && (
            <div className={styles.stat}>
              <i className="fas fa-hourglass" />
              <span>{sessionDuration}</span>
            </div>
          )}
          <div className={styles.stat}>
            <i className="fas fa-chart-simple" />
            <span>{completionRate}% compl.</span>
          </div>
          <div className={styles.stat}>
            <i className="fas fa-skull" />
            <span>
              {totalDeaths} death{totalDeaths !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className={styles.sessionChallenges}>
          <div className={styles.challengesList}>
            {session.challenges.map((challenge, i) => (
              <ChallengeItem
                key={challenge.uuid}
                challenge={challenge}
                challengeIndex={totalChallenges - i} // Most recent first
                groupName={groupName}
                totalChallenges={session.challenges.length}
                icon={
                  challenge === fastestChallenge ? (
                    <i
                      className={`fas fa-star ${styles.goldMedal}`}
                      data-tooltip-id={GLOBAL_TOOLTIP_ID}
                      data-tooltip-content={`Fastest completed ${groupName.toLowerCase()}`}
                    />
                  ) : null
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SkeletonSession() {
  return (
    <div className={styles.sessionCard}>
      <div className={styles.sessionHeader}>
        <div className={styles.sessionTitle}>
          <div className={styles.sessionInfo}>
            <div className={`${styles.skeleton} ${styles.skeletonTitle}`}></div>
            <div className={`${styles.skeleton} ${styles.skeletonMeta}`}></div>
          </div>
          <div className={`${styles.skeleton} ${styles.skeletonButton}`}></div>
        </div>

        <div className={styles.sessionStats}>
          {[...Array(5)].map((_, i) => (
            <div key={i} className={styles.stat}>
              <div
                className={`${styles.skeleton} ${styles.skeletonStat}`}
              ></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionList({
  count,
  sessions,
  isLoading,
}: {
  count: number;
  sessions: SessionWithChallenges[];
  isLoading: boolean;
}) {
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    new Set(),
  );

  const toggleSession = (sessionUuid: string) => {
    setExpandedSessions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(sessionUuid)) {
        newSet.delete(sessionUuid);
      } else {
        newSet.add(sessionUuid);
      }
      return newSet;
    });
  };

  if (isLoading) {
    return (
      <>
        {[...Array(count)].map((_, i) => (
          <SkeletonSession key={i} />
        ))}
      </>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={styles.message}>
        <i className="fas fa-bed" />
        <span>No sessions found</span>
      </div>
    );
  }

  return (
    <>
      {sessions.map((session) => (
        <SessionCard
          key={session.uuid}
          session={session}
          isExpanded={expandedSessions.has(session.uuid)}
          onToggle={() => toggleSession(session.uuid)}
        />
      ))}
    </>
  );
}

export default function SessionHistory(props: SessionHistoryProps) {
  const {
    count,
    type,
    mode,
    scale,
    username,
    initialSessions = [],
    status,
  } = props;

  const [sessions, setSessions] = useState(initialSessions);
  const [isInitialLoading, setIsInitialLoading] = useState(
    initialSessions.length === 0,
  );
  const deferredSessions = useDeferredValue(sessions);

  useEffect(() => {
    const fetchSessions = async () => {
      const params = {
        limit: count.toString(),
        type: type?.toString(),
        scale: scale?.toString(),
        mode: mode?.toString(),
        status: status
          ? Array.isArray(status)
            ? status
            : [status]
          : undefined,
      };
      const sessions = await fetch(
        `/api/v1/sessions?${queryString(params)}`,
      ).then((res) => res.json());
      setSessions(
        sessions.map((s: any) => ({
          ...s,
          startTime: new Date(s.startTime),
          endTime: s.endTime ? new Date(s.endTime) : null,
        })),
      );
      setIsInitialLoading(false);
    };

    fetchSessions();
    const refetchInterval = window.setInterval(fetchSessions, 30 * 1000);
    return () => window.clearInterval(refetchInterval);
  }, [count, type, scale, mode, status]);

  return (
    <div className={styles.history}>
      <SessionList
        count={count}
        sessions={deferredSessions}
        isLoading={isInitialLoading}
      />
    </div>
  );
}
