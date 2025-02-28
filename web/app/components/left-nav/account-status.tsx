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
            <div className={styles.avatar}>
              <i className="fa-solid fa-user" />
            </div>
            <div className={styles.details}>
              <div className={styles.label}>Signed in as</div>
              <div className={styles.username}>
                {session.data.user.name || 'Unknown'}
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
              <i className="fa-solid fa-right-from-bracket" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.authActions}>
          <Link
            className={`${styles.authAction} ${styles.login}`}
            href="/login"
          >
            <i className="fa-solid fa-right-to-bracket" />
            <span>Log In</span>
          </Link>
          <Link
            className={`${styles.authAction} ${styles.signup}`}
            href="/register"
          >
            <i className="fa-solid fa-user-plus" />
            <span>Sign Up</span>
          </Link>
        </div>
      )}
    </div>
  );
}
