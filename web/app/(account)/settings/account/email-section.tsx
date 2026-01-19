'use client';

import { User } from '@blert/common';
import { useState, useTransition } from 'react';

import {
  cancelEmailChange,
  resendVerificationEmail,
  SendVerificationResult,
} from '@/actions/email';
import Button from '@/components/button';
import { useToast } from '@/components/toast';

import EmailChangeForm from './email-change-form';

import sectionStyles from '../style.module.scss';
import styles from './email-section.module.scss';

type EmailSectionProps = {
  user: User;
};

export default function EmailSection({ user }: EmailSectionProps) {
  const showToast = useToast();
  const [isResending, startResendTransition] = useTransition();
  const [isCanceling, startCancelTransition] = useTransition();
  const [pendingEmail, setPendingEmail] = useState(user.pendingEmail);

  const handleResendVerification = () => {
    startResendTransition(async () => {
      const result: SendVerificationResult = await resendVerificationEmail();
      if (result.success) {
        showToast('Verification email sent', 'success');
      } else if (result.error === 'rate_limited') {
        showToast(
          `Please wait ${result.retryAfter} seconds before trying again`,
          'error',
        );
      } else if (result.error === 'already_verified') {
        showToast('Your email is already verified', 'info');
      } else {
        showToast('Failed to send verification email', 'error');
      }
    });
  };

  const handleCancelPendingEmail = () => {
    startCancelTransition(async () => {
      await cancelEmailChange();
      setPendingEmail(null);
      showToast('Email change request cancelled', 'info');
    });
  };

  return (
    <section className={sectionStyles.section}>
      <div className={sectionStyles.sectionHeader}>
        <h2>Email</h2>
        <p className={sectionStyles.description}>Manage your email address.</p>
      </div>

      <div className={styles.emailRow}>
        <span>{user.email}</span>
        {user.emailVerified ? (
          <span className={`${styles.status} ${styles.verified}`}>
            <i className="fas fa-check-circle" />
            Verified
          </span>
        ) : (
          <span className={`${styles.status} ${styles.unverified}`}>
            <i className="fas fa-exclamation-circle" />
            Not verified
          </span>
        )}
        {!user.emailVerified && (
          <button
            className={styles.resendButton}
            onClick={handleResendVerification}
            disabled={isResending}
          >
            {isResending ? 'Sending...' : 'Resend Verification Email'}
          </button>
        )}
      </div>

      {pendingEmail && (
        <div className={styles.pendingEmailBox}>
          <div className={styles.emailRow}>
            <span>
              <strong>Pending email change:</strong> {pendingEmail}
            </span>
            <span className={`${styles.status} ${styles.pending}`}>
              <i className="fas fa-clock" />
              Awaiting verification
            </span>
          </div>
          <p className={styles.pendingEmailHint}>
            Check your inbox at <strong>{pendingEmail}</strong> for a
            confirmation link.
          </p>
          <div className={styles.cancelButton}>
            <Button onClick={handleCancelPendingEmail} disabled={isCanceling}>
              {isCanceling ? 'Cancelling...' : 'Cancel email change'}
            </Button>
          </div>
        </div>
      )}

      {!pendingEmail && (
        <>
          <div className={styles.changeEmailHeader}>
            <h3>Change Email</h3>
            <p>
              Enter your new email address below. We&apos;ll send a verification
              link to confirm the change.
            </p>
          </div>
          <EmailChangeForm onSuccess={setPendingEmail} />
        </>
      )}
    </section>
  );
}
