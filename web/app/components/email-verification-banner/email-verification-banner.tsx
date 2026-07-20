'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/toast';

import styles from './style.module.scss';
import { authClient } from '@/auth-client';

export default function EmailVerificationBanner() {
  const { isPending, data: session } = authClient.useSession();
  const [isResending, setIsResending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const showToast = useToast();
  const bannerRef = useRef<HTMLDivElement>(null);

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

  const visible = !(
    isPending ||
    session === null ||
    session?.user.emailVerified ||
    dismissed
  );

  // Publish the banner's height as a CSS variable so fixed top-of-page elements
  // can offset themselves below it.
  useEffect(() => {
    const root = document.documentElement;
    const el = bannerRef.current;
    if (!visible || el === null) {
      root.style.setProperty('--email-banner-height', '0px');
      return;
    }

    const publishHeight = () => {
      root.style.setProperty('--email-banner-height', `${el.offsetHeight}px`);
    };
    publishHeight();

    const observer = new ResizeObserver(publishHeight);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty('--email-banner-height', '0px');
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <div className={styles.banner} ref={bannerRef}>
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
