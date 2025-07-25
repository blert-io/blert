'use client';

import { useState } from 'react';
import { ChallengeStatus } from '@blert/common';

import Card from '@/components/card';
import SectionTitle from '@/components/section-title';
import { challengeUrl } from '@/utils/url';
import { challengeTerm } from '@/utils/challenge';

import { useSessionContext } from './session-context-provider';

import styles from './actions-bar.module.scss';

function ActionButton({
  icon,
  children,
  onClick,
  variant = 'default',
  disabled = false,
}: {
  icon: string;
  children: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'success';
  disabled?: boolean;
}) {
  return (
    <button
      className={`${styles.actionButton} ${styles[variant]}`}
      onClick={onClick}
      disabled={disabled}
    >
      <i className={`fas ${icon}`} />
      {children}
    </button>
  );
}

export default function ActionsBar() {
  const { session } = useSessionContext();

  const [copiedLink, setCopiedLink] = useState(false);
  const [exportingData, setExportingData] = useState(false);

  if (!session) {
    return <div className={styles.skeletonHeader} />;
  }

  const challengeLabel = challengeTerm(session.challengeType, true);

  const completedRaids = session.challenges.filter(
    (c) => c.status === ChallengeStatus.COMPLETED,
  );

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  };

  const handleExportData = async () => {
    setExportingData(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setExportingData(false);
  };

  const handleOpenAllReplays = () => {
    if (completedRaids.length === 0) {
      return;
    }

    // Open up to 5 replays to avoid overwhelming the browser
    const raidsToOpen = completedRaids.slice(0, 5);

    raidsToOpen.forEach((challenge, index: number) => {
      setTimeout(() => {
        window.open(
          challengeUrl(session.challengeType, challenge.uuid),
          '_blank',
        );
      }, index * 500); // Stagger the opening to avoid popup blockers
    });
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Blert Session - ${session.challengeType}`,
          text: `Check out this ${session.challengeType} session with ${session.challenges.length} ${challengeLabel}!`,
          url: window.location.href,
        });
      } catch (error) {
        // Fallback to copy link if share fails
        handleCopyLink();
      }
    } else {
      // Fallback for browsers without native share
      handleCopyLink();
    }
  };

  return (
    <Card>
      <SectionTitle icon="fa-tools">Session Actions</SectionTitle>

      <div className={styles.actionsGrid}>
        <div className={styles.actionGroup}>
          <div className={styles.groupHeader}>
            <i className="fas fa-share" />
            <span>Share & Export</span>
          </div>
          <div className={styles.actions}>
            <ActionButton
              icon={copiedLink ? 'fa-check' : 'fa-link'}
              onClick={handleShare}
              variant={copiedLink ? 'success' : 'default'}
            >
              {copiedLink ? 'Copied!' : 'Share Session'}
            </ActionButton>

            <ActionButton
              icon={exportingData ? 'fa-spinner fa-spin' : 'fa-download'}
              onClick={handleExportData}
              disabled={exportingData}
            >
              {exportingData ? 'Exporting...' : 'Export Data'}
            </ActionButton>
          </div>
        </div>

        <div className={styles.actionGroup}>
          <div className={styles.groupHeader}>
            <i className="fas fa-play" />
            <span>Replays</span>
          </div>
          <div className={styles.actions}>
            <ActionButton
              icon="fa-external-link-alt"
              onClick={handleOpenAllReplays}
              variant="primary"
              disabled={completedRaids.length === 0}
            >
              Open All Replays ({completedRaids.length})
            </ActionButton>
          </div>
        </div>

        <div className={styles.actionGroup}>
          <div className={styles.groupHeader}>
            <i className="fas fa-info-circle" />
            <span>Session Info</span>
          </div>
          <div className={styles.sessionStats}>
            <div className={styles.sessionStat}>
              <span className={styles.statLabel}>Session ID</span>
              <span className={styles.statValue}>
                {session.uuid.slice(0, 8)}...
              </span>
            </div>
            <div className={styles.sessionStat}>
              <span className={styles.statLabel}>Challenge</span>
              <span className={styles.statValue}>{session.challengeType}</span>
            </div>
            <div className={styles.sessionStat}>
              <span className={styles.statLabel}>Total {challengeLabel}</span>
              <span className={styles.statValue}>
                {session.challenges.length}
              </span>
            </div>
            <div className={styles.sessionStat}>
              <span className={styles.statLabel}>Completed</span>
              <span className={styles.statValue}>{completedRaids.length}</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
