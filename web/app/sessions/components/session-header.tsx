'use client';

import { challengeName, SessionStatus } from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import TimeAgo from 'react-timeago';

import Card from '@/components/card';
import { useToast } from '@/components/toast/toast';
import { useClientOnly } from '@/hooks/client-only';
import { challengeLogo } from '@/logo';
import {
  challengeTerm,
  modeNameAndColor,
  scaleNameAndColor,
} from '@/utils/challenge';

import { useSessionContext } from './session-context-provider';

import styles from './session-header.module.scss';

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

  const [modeName, modeColor] = modeNameAndColor(
    session.challengeType,
    session.challengeMode,
  );
  const [scaleName, scaleColor] = scaleNameAndColor(session.scale);

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Blert Session - ${session.party.join(', ')}`,
          text: `Check out this ${challengeName(session.challengeType)} session with ${stats.completionRate.toFixed(1)}% success rate!`,
          url: window.location.href,
        });
      } catch (err) {
        // Fallback to clipboard
        copyToClipboard();
      }
    } else {
      copyToClipboard();
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Session link copied to clipboard');
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      showToast('Failed to copy link', 'error');
    }
  };

  const handleRefresh = async () => {
    try {
      await refetchSession();
      showToast('Session data refreshed');
    } catch (err) {
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
                      <Link
                        href={`/players/${encodeURIComponent(player)}`}
                        className={styles.playerLink}
                      >
                        {player}
                      </Link>
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
            <div className={styles.badge} style={{ borderColor: modeColor }}>
              <i className="fas fa-trophy" style={{ color: modeColor }} />
              <span>{modeName}</span>
            </div>

            <div className={styles.badge} style={{ borderColor: scaleColor }}>
              <i className="fas fa-users" style={{ color: scaleColor }} />
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
                        ? 'var(--blert-button)'
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
          <button className={styles.actionButton} onClick={handleShare}>
            <i className="fas fa-share" />
            Share
          </button>
          {isLive && (
            <button
              className={`${styles.actionButton} ${isLoading ? styles.loading : ''}`}
              onClick={handleRefresh}
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
