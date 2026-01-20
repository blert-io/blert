'use client';

import { User } from '@blert/common';
import { useTransition } from 'react';

import { authClient } from '@/auth-client';
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

  const handleResendVerification = () => {
    startResendTransition(async () => {
      const result = await authClient.sendVerificationEmail({
        email: user.email,
        callbackURL: '/email-verified?type=new_email',
      });
      if (result.data?.status === true) {
        showToast('Verification email sent', 'success');
      } else {
        showToast('Failed to send verification email', 'error');
      }
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

      <div className={styles.changeEmailHeader}>
        <h3>Change Email</h3>
        <p>
          Enter your new email address below. We&apos;ll send a verification
          link to confirm the change.
        </p>
      </div>
      <EmailChangeForm />
    </section>
  );
}
