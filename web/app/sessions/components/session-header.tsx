'use client';

import { challengeName, SessionStatus } from '@blert/common';
import Image from 'next/image';
import TimeAgo from 'react-timeago';

import Card from '@/components/card';
import { useToast } from '@/components/toast/toast';
import { useClientOnly } from '@/hooks/client-only';
import { challengeLogo } from '@/logo';
import {
  challengeSlug,
  challengeTerm,
  modeName,
  scaleNameAndColor,
} from '@/utils/challenge';

import { useSessionContext } from './session-context-provider';

import styles from './session-header.module.scss';
import PlayerLink from '@/components/player-link';

export default function SessionHeader() {
  const isClient = useClientOnly();
  const showToast = useToast();
  const { isLoading, refetchSession, session } = useSessionContext();

  if (!session) {
    return <div className={styles.skeletonHeader} />;
  }

  const stats = session.stats;

  const isLive = session.status === SessionStatus.ACTIVE;
  const timeReference = isLive ? session.startTime : session.endTime!;

  const mode = modeName(session.challengeType, session.challengeMode);
  const [scaleName] = scaleNameAndColor(session.scale);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Blert Session - ${session.party.join(', ')}`,
          text: `Check out this ${challengeName(session.challengeType)} session with ${stats.completionRate.toFixed(1)}% success rate!`,
          url: window.location.href,
        });
      } catch {
        // Fallback to clipboard
        void copyToClipboard();
      }
    } else {
      void copyToClipboard();
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Session link copied to clipboard', 'success');
    } catch (e) {
      console.error('Failed to copy to clipboard:', e);
      showToast('Failed to copy link', 'error');
    }
  };

  const handleRefresh = async () => {
    try {
      await refetchSession();
      showToast('Session data refreshed');
    } catch {
      showToast('Failed to refresh data', 'error');
    }
  };

  return (
    <Card
      primary
      className={`${styles.sessionHeader} ${isLive ? styles.activeSession : ''}`}
    >
      <div className={styles.headerContent}>
        <div className={styles.sessionInfo}>
          <div className={styles.partyAndStatus}>
            <div className={styles.partyInfo}>
              <div className={styles.titleRow}>
                <div className={styles.challengeLogo}>
                  <Image
                    src={challengeLogo(session.challengeType)}
                    alt={challengeName(session.challengeType)}
                    height={32}
                    width={32}
                    style={{ objectFit: 'contain' }}
                  />
                </div>
                <h1 className={styles.partyNames}>
                  {session.party.map((player, index) => (
                    <span key={player}>
                      <PlayerLink
                        username={player}
                        className={styles.playerLink}
                      >
                        {player}
                      </PlayerLink>
                      {index < session.party.length - 1 && (
                        <span className={styles.dotSeparator}> • </span>
                      )}
                    </span>
                  ))}
                </h1>
              </div>

              <div className={styles.sessionDuration}>
                <i className="fas fa-clock" />
                {isClient && (
                  <span>
                    {isLive ? 'Started' : 'Finished'}{' '}
                    <TimeAgo date={timeReference} />
                  </span>
                )}
                {isLive && (
                  <div className={styles.liveIndicator}>
                    <span className={styles.pulsingDot} />
                    Live
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={styles.sessionBadges}>
            <div
              className={styles.badge}
              data-challenge={challengeSlug(
                session.challengeType,
                session.challengeMode,
              )}
            >
              <i className="fas fa-trophy" />
              <span>{mode}</span>
            </div>

            <div className={styles.badge} data-scale={session.scale}>
              <i className="fas fa-users" />
              <span>{scaleName}</span>
            </div>

            <div className={styles.badge}>
              <i
                className="fas fa-chart-simple"
                style={{
                  color:
                    stats.completionRate >= 80
                      ? 'var(--blert-green)'
                      : stats.completionRate >= 50
                        ? 'var(--blert-purple)'
                        : 'var(--blert-red)',
                }}
              />
              <span>{stats.completionRate.toFixed(1)}% success</span>
            </div>

            <div className={styles.badge}>
              <i className="fas fa-list-ol" />
              <span>
                {stats.challenges}{' '}
                {challengeTerm(session.challengeType, stats.challenges !== 1)}
              </span>
            </div>
          </div>
        </div>

        <div className={styles.quickActions}>
          <button
            className={styles.actionButton}
            onClick={() => void handleShare()}
          >
            <i className="fas fa-share" />
            Share
          </button>
          {isLive && (
            <button
              className={`${styles.actionButton} ${isLoading ? styles.loading : ''}`}
              onClick={() => void handleRefresh()}
              disabled={isLoading}
            >
              <i className={`fas fa-sync ${isLoading ? 'fa-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
