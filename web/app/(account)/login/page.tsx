import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import LoginForm from './login-form';

import styles from './style.module.scss';

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
    <div className={styles.loginPanel}>
      <h1>Sign in to Blert</h1>
      <LoginForm redirectTo={next} />
      <Link className={styles.register} href="/register">
        Don&apos;t have an account? Register
      </Link>
    </div>
  );
}

export const metadata = {
  title: 'Login',
  description: 'Login to your Blert account',
};
