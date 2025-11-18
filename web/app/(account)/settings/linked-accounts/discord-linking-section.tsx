'use client';

import { useEffect, useRef, useState } from 'react';

import type { DiscordLinkStatus, LinkingCode } from '@/actions/users';
import {
  generateDiscordLinkingCode,
  getDiscordLinkStatus,
  unlinkDiscord,
} from '@/actions/users';
import ConfirmationModal from '@/components/confirmation-modal';
import { useToast } from '@/components/toast';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import styles from '../style.module.scss';

type Props = {
  initialStatus: DiscordLinkStatus;
  initialLinkingCode: LinkingCode | null;
  autoGenerate: boolean;
};

export default function DiscordLinkingSection({
  initialStatus,
  initialLinkingCode,
  autoGenerate,
}: Props) {
  const [linkStatus, setLinkStatus] = useState(initialStatus);
  const [linkingCode, setLinkingCode] = useState<LinkingCode | null>(
    initialLinkingCode,
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [showUnlinkModal, setShowUnlinkModal] = useState(false);
  const [showLinkSuccess, setShowLinkSuccess] = useState(false);
  const successTimeoutRef = useRef<number | null>(null);
  const previousLinkState = useRef(linkStatus.isLinked);
  const showToast = useToast();

  // Auto-generate code if URL param is present.
  useEffect(() => {
    if (autoGenerate && !linkStatus.isLinked && !linkingCode) {
      void handleGenerateCode();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!linkingCode) {
      setTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const expiresAt = new Date(linkingCode.expiresAt).getTime();
      const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0) {
        setLinkingCode(null);
        showToast('Linking code expired. Generate a new one.', 'info');
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [linkingCode, showToast]);

  useEffect(() => {
    if (!linkingCode || linkStatus.isLinked) {
      return;
    }

    let isCancelled = false;
    const POLL_INTERVAL_MS = 5000;

    const refreshLinkStatus = async () => {
      try {
        const status = await getDiscordLinkStatus();
        if (isCancelled) {
          return;
        }

        const shouldClearCode = status.isLinked;
        setLinkStatus((previous) => {
          if (
            previous.isLinked === status.isLinked &&
            previous.discordId === status.discordId &&
            previous.discordUsername === status.discordUsername
          ) {
            return previous;
          }

          return status;
        });

        if (shouldClearCode) {
          setLinkingCode(null);
        }
      } catch (error) {
        console.error('Failed to refresh Discord link status', error);
      }
    };

    const interval = window.setInterval(() => {
      void refreshLinkStatus();
    }, POLL_INTERVAL_MS);

    void refreshLinkStatus();

    return () => {
      isCancelled = true;
      window.clearInterval(interval);
    };
  }, [linkingCode, linkStatus.isLinked]);

  useEffect(() => {
    if (!previousLinkState.current && linkStatus.isLinked) {
      setShowLinkSuccess(true);
    }
    previousLinkState.current = linkStatus.isLinked;
  }, [linkStatus.isLinked]);

  useEffect(() => {
    if (!showLinkSuccess) {
      return;
    }

    if (successTimeoutRef.current) {
      window.clearTimeout(successTimeoutRef.current);
    }

    successTimeoutRef.current = window.setTimeout(() => {
      setShowLinkSuccess(false);
    }, 3500);

    return () => {
      if (successTimeoutRef.current) {
        window.clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
    };
  }, [showLinkSuccess]);

  const handleGenerateCode = async () => {
    setIsGenerating(true);
    try {
      const code = await generateDiscordLinkingCode();
      setLinkingCode(code);
      showToast('Linking code generated!', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to generate code',
        'error',
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUnlinkConfirm = async () => {
    setIsUnlinking(true);
    try {
      await unlinkDiscord();
      setLinkStatus({
        isLinked: false,
        discordId: null,
        discordUsername: null,
      });
      setShowUnlinkModal(false);
      showToast('Discord account unlinked', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to unlink account',
        'error',
      );
    } finally {
      setIsUnlinking(false);
    }
  };

  const handleCopyCode = async () => {
    if (!linkingCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(linkingCode.code);
      setIsCopied(true);
      showToast('Code copied to clipboard!', 'success');
      setTimeout(() => setIsCopied(false), 4000);
    } catch {
      showToast('Failed to copy code', 'error');
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const selectText = (element: HTMLElement) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  return (
    <>
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>
            <i className="fab fa-discord" />
            Discord
          </h2>
        </div>

        {showLinkSuccess ? (
          <div className={styles.linkSuccess}>
            <div className={styles.successIcon}>
              <i className="fas fa-check" />
            </div>
            <div className={styles.successContent}>
              <h3>Discord linked!</h3>
              <p>
                {linkStatus.discordUsername ? (
                  <span>{linkStatus.discordUsername}</span>
                ) : (
                  'Your Discord account '
                )}
                is now connected.
              </p>
            </div>
          </div>
        ) : linkStatus.isLinked ? (
          <div className={styles.linkedAccount}>
            <div className={styles.accountInfo}>
              <i className={`fas fa-check-circle ${styles.linkedIcon}`} />
              <div className={styles.accountDetails}>
                <div className={styles.accountLabel}>Linked Account</div>
                <div className={styles.accountValue}>
                  {linkStatus.discordUsername}
                </div>
              </div>
            </div>
            <button
              className={styles.unlinkButton}
              onClick={() => setShowUnlinkModal(true)}
              disabled={isUnlinking}
            >
              <i className="fas fa-unlink" />
              Unlink
            </button>
          </div>
        ) : (
          <div className={styles.unlinkedAccount}>
            <div className={styles.instructionsBox}>
              <div className={styles.step}>
                <div className={styles.stepNumber}>1</div>
                <div className={styles.stepContent}>
                  <h3>Generate a verification code</h3>
                  <p>
                    Click the button below to generate a unique code that
                    expires in 15 minutes.
                  </p>
                </div>
              </div>
              <div className={styles.step}>
                <div className={styles.stepNumber}>2</div>
                <div className={styles.stepContent}>
                  <h3>Enter the code in Discord</h3>
                  <p>
                    Use the <code>/verify</code> command in the Blert Discord
                    server and paste your code.
                  </p>
                </div>
              </div>
              <div className={`${styles.step} ${styles.completion}`}>
                <div className={styles.stepContent}>
                  <h3>That&apos;s it! You&apos;re done.</h3>
                </div>
              </div>
            </div>

            {linkingCode ? (
              <div className={styles.codeDisplay}>
                <div className={styles.codeBox}>
                  <div className={styles.codeLabel}>Your verification code</div>
                  <div className={styles.codeValue}>
                    <span onClick={(e) => selectText(e.currentTarget)}>
                      {linkingCode.code}
                    </span>
                    <button
                      className={styles.copyButton}
                      onClick={() => void handleCopyCode()}
                      disabled={isCopied}
                      data-tooltip-id={GLOBAL_TOOLTIP_ID}
                      data-tooltip-content={isCopied ? 'Copied!' : 'Copy code'}
                    >
                      <i className={`fas fa-${isCopied ? 'check' : 'copy'}`} />
                    </button>
                  </div>
                  {timeRemaining !== null && (
                    <div className={styles.codeExpiry}>
                      Expires in{' '}
                      <span className={styles.time}>
                        {formatTime(timeRemaining)}
                      </span>
                    </div>
                  )}
                </div>
                <p className={styles.codeHint}>
                  Copy this code and use{' '}
                  <code onClick={(e) => selectText(e.currentTarget)}>
                    /verify {linkingCode.code}
                  </code>{' '}
                  in the Blert Discord server.
                </p>
              </div>
            ) : (
              <button
                className={styles.generateButton}
                onClick={() => void handleGenerateCode()}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <i className="fas fa-spinner fa-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <i className="fas fa-key" />
                    Generate Linking Code
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      <ConfirmationModal
        open={showUnlinkModal}
        onClose={() => setShowUnlinkModal(false)}
        onConfirm={() => void handleUnlinkConfirm()}
        title="Unlink Discord Account"
        message={
          <>
            Are you sure you want to unlink your Discord account{' '}
            <strong>{linkStatus.discordUsername}</strong>? You will need to
            generate a new code to link it again.
          </>
        }
        confirmText="Unlink"
        cancelText="Cancel"
        variant="danger"
        loading={isUnlinking}
      />
    </>
  );
}
