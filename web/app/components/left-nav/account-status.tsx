'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { authClient } from '@/auth-client';
import { useToast } from '@/components/toast';
import { useClientOnly } from '@/hooks/client-only';

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

import styles from './styles.module.scss';

export function AccountStatusSkeleton() {
  return (
    <div className={styles.account}>
      <div className={styles.userWrapper}>
        <div className={styles.userInfo}>
          <div className={`${styles.avatar} ${styles.skeleton}`} />
          <div className={styles.details}>
            <div className={`${styles.skeletonText} ${styles.skeletonLabel}`} />
            <div
              className={`${styles.skeletonText} ${styles.skeletonUsername}`}
            />
          </div>
        </div>
        <div className={styles.actions}>
          <div className={`${styles.skeletonAction}`} />
          <div className={`${styles.skeletonAction}`} />
        </div>
      </div>
    </div>
  );
}

export default function AccountStatus({}) {
  const currentPath = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const session = authClient.useSession();
  const isMounted = useClientOnly();
  const showToast = useToast();

  if (session.isPending || !isMounted) {
    return <AccountStatusSkeleton />;
  }

  const currentUrl =
    searchParams.size > 0
      ? `${currentPath}?${searchParams.toString()}`
      : currentPath;

  const shouldRedirect = !AVOID_REDIRECT_ROUTES.includes(currentPath);
  const redirectParams = shouldRedirect
    ? `?next=${encodeURIComponent(currentUrl)}`
    : '';

  return (
    <div className={styles.account}>
      {session.data ? (
        <div className={styles.userWrapper}>
          <div className={styles.userInfo}>
            <div className={styles.avatar}>
              <i className="fa-solid fa-user" />
            </div>
            <div className={styles.details}>
              <div className={styles.label}>Signed in as</div>
              <div className={styles.username}>
                {session.data.user.displayUsername ??
                  session.data.user.username ??
                  'Unknown'}
              </div>
            </div>
          </div>
          <div className={styles.actions}>
            <Link className={styles.action} href="/settings">
              <i className="fa-solid fa-gear" />
              <span>Settings</span>
            </Link>
            <button
              className={styles.action}
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
              <span>Log Out</span>
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.authActions}>
          <Link
            className={`${styles.authAction} ${styles.login}`}
            href={`/login${redirectParams}`}
          >
            <i className="fa-solid fa-right-to-bracket" />
            <span>Log In</span>
          </Link>
          <Link
            className={`${styles.authAction} ${styles.signup}`}
            href={`/register${redirectParams}`}
          >
            <i className="fa-solid fa-user-plus" />
            <span>Sign Up</span>
          </Link>
        </div>
      )}
    </div>
  );
}
