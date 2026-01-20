import { headers } from 'next/headers';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MAIN_LOGO } from '@/logo';
import { validateRedirectUrl } from '@/utils/url';

import LoginForm from './login-form';

import styles from '../style.module.scss';

type LoginProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

export default async function Login({ searchParams }: LoginProps) {
  const { next } = await searchParams;
  const redirectTo = validateRedirectUrl(next);

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (session !== null) {
    redirect(redirectTo);
  }

  return (
    <div className={styles.authPanel}>
      <div className={styles.logo}>
        <Image
          src={MAIN_LOGO}
          alt="Blert logo"
          fill
          sizes="140px"
          style={{ objectFit: 'contain' }}
        />
      </div>
      <h1>Welcome back!</h1>
      <p className={styles.subtitle}>Sign in to continue to Blert</p>
      <LoginForm redirectTo={redirectTo} />
      <div className={styles.altLink}>
        <Link href="/forgot-password">Forgot your password?</Link>
      </div>
      <div className={styles.divider}>or</div>
      <div className={styles.altLink}>
        New to Blert?
        <Link
          href={
            redirectTo === '/'
              ? '/register'
              : `/register?next=${encodeURIComponent(redirectTo)}`
          }
        >
          Create an account
        </Link>
      </div>
    </div>
  );
}

export const metadata = {
  title: 'Login',
  description: 'Login to your Blert account',
};
