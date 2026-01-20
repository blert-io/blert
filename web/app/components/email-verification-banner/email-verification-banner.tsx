'use client';

import { useCallback, useState } from 'react';

import { useToast } from '@/components/toast';

import styles from './style.module.scss';
import { authClient } from '@/auth-client';

export default function EmailVerificationBanner() {
  const { isPending, data: session } = authClient.useSession();
  const [isResending, setIsResending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const showToast = useToast();

  const email = session?.user.email ?? '';

  const handleResend = useCallback(async () => {
    setIsResending(true);
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: '/email-verified?type=new_email',
      });
      if (result.data?.status === true) {
        showToast('Verification email sent!', 'success');
      } else {
        showToast('Failed to send verification email.', 'error');
      }
    } finally {
      setIsResending(false);
    }
  }, [showToast, email]);

  if (
    isPending ||
    session === null ||
    session?.user.emailVerified ||
    dismissed
  ) {
    return null;
  }

  return (
    <div className={styles.banner}>
      <div className={styles.content}>
        <i className="fas fa-envelope" aria-hidden="true" />
        <span>
          Please check your email inbox for a verification link.{' '}
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
