import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import LoginForm from './login-form';

import styles from './style.module.scss';

export default async function Login() {
  const session = await auth();
  if (session !== null) {
    redirect('/');
  }

  return (
    <div className={styles.loginPanel}>
      <h1>Sign in to Blert</h1>
      <LoginForm />
      <Link className={styles.register} href="/register">
        Don't have an account? Register
      </Link>
    </div>
  );
}

export const metadata = {
  title: 'Login | Blert',
  description: 'Login to your Blert account',
};
