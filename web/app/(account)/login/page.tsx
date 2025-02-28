import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MAIN_LOGO } from '@/logo';

import LoginForm from './login-form';

import styles from '../style.module.scss';

type LoginProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

export default async function Login({ searchParams }: LoginProps) {
  const { next } = await searchParams;

  const session = await auth();
  if (session !== null) {
    redirect(next ?? '/');
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
      <LoginForm redirectTo={next} />
      <div className={styles.altLink}>
        New to Blert?<Link href="/register">Create an account</Link>
      </div>
    </div>
  );
}

export const metadata = {
  title: 'Login',
  description: 'Login to your Blert account',
};
