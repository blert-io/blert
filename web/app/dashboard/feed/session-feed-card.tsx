'use client';

import {
  ChallengeMode,
  ChallengeStatus,
  SessionStatus,
  challengeName,
} from '@blert/common';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { MouseEvent } from 'react';
import TimeAgo from 'react-timeago';

import { SessionFeedItem } from '@/actions/feed';
import PlayerLink from '@/components/player-link';
import { useClientOnly } from '@/hooks/client-only';
import { challengeLogo } from '@/logo';
import { modeNameAndColor, scaleNameAndColor } from '@/utils/challenge';
import { formatDuration } from '@/utils/time';

import styles from './feed.module.scss';

type SessionFeedCardProps = {
  item: SessionFeedItem;
};

export default function SessionFeedCard({ item }: SessionFeedCardProps) {
  const router = useRouter();
  const isClient = useClientOnly();
  const { session, partyCurrentNames, followedPlayers } = item;

  const followedUsernames = new Set(
    followedPlayers.map((u) => u.toLowerCase()),
  );

  const currentNameForLink = (index: number): string => {
    return partyCurrentNames[index] ?? session.party[index];
  };

  const isActive = session.status === SessionStatus.ACTIVE;
  const totalChallenges = session.challenges.length;

  let completedChallenges = 0;
  let resetChallenges = 0;
  let wipedChallenges = 0;
  let totalDeaths = 0;
  for (const c of session.challenges) {
    if (c.status === ChallengeStatus.COMPLETED) {
      completedChallenges += 1;
    } else if (c.status === ChallengeStatus.RESET) {
      resetChallenges += 1;
    } else if (c.status === ChallengeStatus.WIPED) {
      wipedChallenges += 1;
    }
    totalDeaths += c.totalDeaths;
  }

  const endTime = session.endTime ?? new Date();
  const sessionDuration = formatDuration(
    endTime.getTime() - session.startTime.getTime(),
  );

  const [modeString] = modeNameAndColor(
    session.challengeType,
    session.challengeMode,
    false,
  );
  const [scaleString] = scaleNameAndColor(session.scale);

  const handleCardClick = () => {
    router.push(`/sessions/${session.uuid}`);
  };

  return (
    <div
      className={`${styles.feedCard} ${styles.sessionCard} ${isActive ? styles.active : ''}`}
      onClick={handleCardClick}
    >
      <div className={styles.cardHeader}>
        <div className={styles.sessionInfo}>
          <Image
            src={challengeLogo(session.challengeType)}
            alt={challengeName(session.challengeType)}
            width={24}
            height={24}
            className={styles.challengeIcon}
          />
          <div className={styles.sessionTitle}>
            <h3>
              {challengeName(session.challengeType)} ({scaleString}
              {session.challengeMode !== ChallengeMode.NO_MODE &&
                `, ${modeString}`}
              )
            </h3>
            <div className={styles.sessionMeta}>
              {isActive && (
                <>
                  <span className={styles.liveIndicator}>
                    <span className={styles.pulsingDot} />
                    Live
                  </span>
                  <span className={styles.separator}>•</span>
                </>
              )}
              <span>
                {totalChallenges} run{totalChallenges !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>
        <div className={styles.cardHeaderRight}>
          <span className={styles.timestamp}>
            {isClient && <TimeAgo date={item.timestamp} />}
          </span>
          <i className={`fas fa-chevron-right ${styles.cardArrow}`} />
        </div>
      </div>

      <div className={styles.sessionBody}>
        <div className={styles.partyList}>
          {session.party.map((player, index) => {
            const currentName = currentNameForLink(index);
            const isFollowed = followedUsernames.has(currentName.toLowerCase());
            return (
              <span key={player} className={styles.partyMember}>
                <PlayerLink
                  username={currentName}
                  className={isFollowed ? styles.followed : styles.playerName}
                  onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                  }}
                >
                  {player}
                </PlayerLink>
                {index < session.party.length - 1 && (
                  <span className={styles.comma}>,</span>
                )}
              </span>
            );
          })}
        </div>

        <div className={styles.sessionStats}>
          <div className={`${styles.stat} ${styles.statCompleted}`}>
            <i className="fas fa-flag-checkered" />
            <span>{completedChallenges} completed</span>
          </div>
          {resetChallenges > 0 && (
            <div className={`${styles.stat} ${styles.statReset}`}>
              <i className="fas fa-rotate-left" />
              <span>{resetChallenges} reset</span>
            </div>
          )}
          {wipedChallenges > 0 && (
            <div className={`${styles.stat} ${styles.statWiped}`}>
              <i className="fas fa-x" />
              <span>{wipedChallenges} wiped</span>
            </div>
          )}
          <div className={`${styles.stat} ${styles.statDeaths}`}>
            <i className="fas fa-skull" />
            <span>
              {totalDeaths} death{totalDeaths !== 1 ? 's' : ''}
            </span>
          </div>
          {sessionDuration && (
            <div className={styles.stat}>
              <i className="fas fa-clock" />
              <span>{sessionDuration}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
