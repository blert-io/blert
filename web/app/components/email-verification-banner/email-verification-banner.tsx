'use client';

import { useSession } from 'next-auth/react';
import { useCallback, useState } from 'react';

import { resendVerificationEmail } from '@/actions/email';
import { useToast } from '@/components/toast';

import styles from './style.module.scss';

export default function EmailVerificationBanner() {
  const { data: session, status } = useSession();
  const [isResending, setIsResending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const showToast = useToast();

  const handleResend = useCallback(async () => {
    setIsResending(true);
    try {
      const result = await resendVerificationEmail();
      if (result.success) {
        showToast('Verification email sent!', 'success');
      } else if (result.error === 'rate_limited') {
        showToast(
          `Please wait ${result.retryAfter} seconds before requesting another email.`,
          'error',
        );
      } else if (result.error === 'already_verified') {
        showToast('Your email is already verified!', 'success');
        setDismissed(true);
      } else {
        showToast('Failed to send verification email.', 'error');
      }
    } finally {
      setIsResending(false);
    }
  }, [showToast]);

  if (
    status === 'loading' ||
    status === 'unauthenticated' ||
    session?.user.isEmailVerified ||
    dismissed
  ) {
    return null;
  }

  return (
    <div className={styles.banner}>
      <div className={styles.content}>
        <i className="fas fa-envelope" aria-hidden="true" />
        <span>
          Please verify your email address.{' '}
          <button
            onClick={() => void handleResend()}
            disabled={isResending}
            className={styles.resendLink}
            type="button"
          >
            {isResending ? 'Sending...' : 'Resend verification email'}
          </button>
        </span>
      </div>
      <button
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        type="button"
      >
        <i className="fas fa-times" aria-hidden="true" />
      </button>
    </div>
  );
}
