'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { authClient } from '@/auth-client';
import { ButtonLink } from '@/components/button';
import { useToast } from '@/components/toast';
import { useClientOnly } from '@/hooks/client-only';

import styles from './styles.module.scss';

const PROTECTED_ROUTES = ['/settings'];

/** Routes to which users should not be redirected to after logging in. */
const AVOID_REDIRECT_ROUTES = [
  '/',
  '/home',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/email-verified',
];

type AccountStatusProps = {
  /** Glyph-only rendering for the collapsed sidebar. Defaults to `full`. */
  variant?: 'full' | 'mini';
};

export function AccountStatusSkeleton({
  variant = 'full',
}: AccountStatusProps) {
  if (variant === 'mini') {
    return (
      <div
        className={`${styles.collapsedAvatar} ${styles.collapsedSkeleton}`}
      />
    );
  }

  return (
    <div className={styles.account}>
      <div className={styles.card}>
        <div className={`${styles.avatar} ${styles.skeleton}`} />
        <div className={`${styles.skeletonText} ${styles.skeletonUsername}`} />
      </div>
    </div>
  );
}

export default function AccountStatus({
  variant = 'full',
}: AccountStatusProps) {
  const currentPath = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const session = authClient.useSession();
  const isMounted = useClientOnly();
  const showToast = useToast();

  if (session.isPending || !isMounted) {
    return <AccountStatusSkeleton variant={variant} />;
  }

  const currentUrl =
    searchParams.size > 0
      ? `${currentPath}?${searchParams.toString()}`
      : currentPath;

  const shouldRedirect = !AVOID_REDIRECT_ROUTES.includes(currentPath);
  const redirectParams = shouldRedirect
    ? `?next=${encodeURIComponent(currentUrl)}`
    : '';

  if (session.data) {
    if (variant === 'mini') {
      return (
        <Link
          className={styles.collapsedAvatar}
          href="/settings"
          title="Account"
          aria-label="Account"
        >
          <i className="fa-solid fa-user" />
        </Link>
      );
    }

    const username =
      session.data.user.displayUsername ??
      session.data.user.username ??
      'Unknown';

    return (
      <div className={styles.account}>
        <div className={styles.card}>
          <div className={styles.avatar}>
            <i className="fa-solid fa-user" />
          </div>
          <div className={styles.username} title={username}>
            {username}
          </div>
          <div className={styles.actions}>
            <Link
              className={styles.iconAction}
              href="/settings"
              title="Settings"
              aria-label="Settings"
            >
              <i className="fa-solid fa-gear" />
            </Link>
            <button
              className={styles.iconAction}
              title="Log out"
              aria-label="Log out"
              onClick={() =>
                void authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      const isProtected = PROTECTED_ROUTES.some((route) =>
                        currentPath.startsWith(route),
                      );
                      router.replace(isProtected ? '/' : currentUrl);
                      showToast('Logged out of Blert');
                    },
                  },
                })
              }
            >
              <i className="fa-solid fa-right-from-bracket" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'mini') {
    return (
      <>
        <Link
          className={styles.collapsedAvatar}
          href={`/login${redirectParams}`}
          title="Log in"
          aria-label="Log in"
        >
          <i className="fa-solid fa-right-to-bracket" />
        </Link>
        <Link
          className={styles.collapsedAvatar}
          href={`/register${redirectParams}`}
          title="Sign up"
          aria-label="Sign up"
        >
          <i className="fa-solid fa-user-plus" />
        </Link>
      </>
    );
  }

  return (
    <div className={styles.account}>
      <div className={styles.authButtons}>
        <ButtonLink
          className={styles.authButton}
          simple
          href={`/login${redirectParams}`}
        >
          <i className="fa-solid fa-right-to-bracket" />
          <span>Log In</span>
        </ButtonLink>
        <ButtonLink
          className={styles.authButton}
          href={`/register${redirectParams}`}
        >
          <i className="fa-solid fa-user-plus" />
          <span>Sign Up</span>
        </ButtonLink>
      </div>
    </div>
  );
}
