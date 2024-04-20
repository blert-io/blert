'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';

const PROTECTED_ROUTES = ['/dashboard', '/settings'];

import styles from './styles.module.scss';

export default function AccountStatus() {
  const currentPath = usePathname();
  const router = useRouter();

  const session = useSession();

  return (
    <div className={styles.account}>
      {session.status === 'authenticated' ? (
        <div className={styles.userWrapper}>
          <div className={styles.userInfo}>
            Signed in as <span>{session.data.user.name || 'Unknown'}</span>
          </div>
          <div className={styles.links}>
            <Link className={styles.link} href="/settings">
              Settings
            </Link>
            <button
              className={styles.link}
              onClick={async () => {
                const { url } = await signOut({
                  redirect: false,
                  callbackUrl: PROTECTED_ROUTES.includes(currentPath)
                    ? '/'
                    : currentPath,
                });
                router.replace(url);
              }}
            >
              Log Out
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.links}>
          <Link className={styles.link} href="/login">
            Log In
          </Link>
          <Link className={styles.link} href="/register">
            Sign Up
          </Link>
        </div>
      )}
    </div>
  );
}
