'use client';

import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  SessionStatus,
  challengeName,
} from '@blert/common';
import Link from 'next/link';
import { Suspense, useDeferredValue, useEffect, useState } from 'react';
import TimeAgo from 'react-timeago';

import { ChallengeOverview, SessionWithChallenges } from '@/actions/challenge';
import {
  modeNameAndColor,
  statusNameAndColor,
  scaleNameAndColor,
} from '@/components/raid-quick-details/status';
import { useClientOnly } from '@/hooks/client-only';
import { challengeUrl, queryString } from '@/utils/url';
import { ticksToFormattedSeconds } from '@/utils/tick';

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
  groupName,
  totalChallenges,
}: {
  challenge: ChallengeOverview;
  challengeIndex: number;
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
      </div>

      <div className={styles.challengeDetails}>
        <div className={styles.challengeDetail} style={{ color: modeColor }}>
          <i className="fa-solid fa-trophy" style={{ color: modeColor }} />
          <span>{modeString}</span>
        </div>

        <div className={styles.challengeDetail} style={{ color: statusColor }}>
          <i
            className={`fa-solid ${getStatusIcon(challenge.status)}`}
            style={{ color: statusColor }}
          />
          <span>{statusString}</span>
        </div>

        <div className={styles.challengeDetail}>
          <i className="fa-solid fa-hourglass"></i>
          <span>{ticksToFormattedSeconds(challenge.challengeTicks)}</span>
        </div>

        <div className={styles.challengeDetail}>
          <i className="fa-solid fa-skull"></i>
          <span>
            {challenge.totalDeaths} Death
            {challenge.totalDeaths !== 1 ? 's' : ''}
          </span>
        </div>

        <div className={styles.challengeDetail}>
          <i className="fa-solid fa-clock"></i>
          {isClient && <TimeAgo date={challenge.startTime} />}
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
  const durationMins = Math.round(
    (end.getTime() - session.startTime.getTime()) / 1000 / 60,
  );
  let sessionDuration: string;
  if (durationMins > 60) {
    sessionDuration = `${Math.round(durationMins / 60)}h ${durationMins % 60}m`;
  } else {
    sessionDuration = `${durationMins}m`;
  }

  const timeReference =
    session.status === SessionStatus.ACTIVE
      ? session.startTime
      : session.endTime;
  const timeText =
    session.status === SessionStatus.ACTIVE ? 'Started' : 'Finished';
  const timeColor =
    session.status === SessionStatus.ACTIVE
      ? 'var(--blert-blue)'
      : 'var(--blert-green)';

  const groupName = [
    ChallengeType.TOB,
    ChallengeType.TOA,
    ChallengeType.COX,
  ].includes(session.challengeType)
    ? 'Raid'
    : 'Run';

  return (
    <div className={styles.sessionCard}>
      <div className={styles.sessionHeader} onClick={onToggle}>
        <div className={styles.sessionTitle}>
          <div className={styles.sessionInfo}>
            <h3 className={styles.sessionName}>
              {challengeName(session.challengeType)} ·{' '}
              {scaleNameAndColor(session.scale)[0]} ·{' '}
              {
                modeNameAndColor(
                  session.challengeType,
                  session.challengeMode,
                  false,
                )[0]
              }
            </h3>
            <div className={styles.sessionMeta}>
              <span style={{ color: timeColor }}>
                <i className="fa-solid fa-clock"></i>
                {timeText}{' '}
                {isClient && timeReference && <TimeAgo date={timeReference} />}
              </span>
              <span className={styles.separator}>•</span>
              <span>{session.party.join(', ')}</span>
            </div>
          </div>
          <button className={styles.expandButton}>
            <i
              className={`fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}`}
            ></i>
          </button>
        </div>

        <div className={styles.sessionStats}>
          <div className={styles.stat}>
            <i className="fa-solid fa-list-ol"></i>
            <span>
              {totalChallenges} {groupName.toLowerCase()}
              {totalChallenges !== 1 ? 's' : ''}
            </span>
          </div>
          {sessionDuration && (
            <div className={styles.stat}>
              <i className="fa-solid fa-hourglass"></i>
              <span>{sessionDuration}</span>
            </div>
          )}
          <div className={styles.stat}>
            <i className="fa-solid fa-chart-simple"></i>
            <span>{completionRate}% completions</span>
          </div>
          <div className={styles.stat}>
            <i className="fa-solid fa-skull"></i>
            <span>
              {totalDeaths} total death{totalDeaths !== 1 ? 's' : ''}
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
          {[...Array(4)].map((_, i) => (
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
  sessions,
  isLoading,
}: {
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
        {[...Array(5)].map((_, i) => (
          <SkeletonSession key={i} />
        ))}
      </>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className={styles.message}>
        <i className="fa-solid fa-bed"></i>
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
      <Suspense fallback={<div className={styles.message}>Loading...</div>}>
        <SessionList sessions={deferredSessions} isLoading={isInitialLoading} />
      </Suspense>
    </div>
  );
}
