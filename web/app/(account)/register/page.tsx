import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import RegisterForm from './register-form';

import styles from './style.module.scss';

export default async function Register() {
  const session = await auth();
  if (session !== null) {
    redirect('/');
  }

  return (
    <div className={styles.registerPanel}>
      <h1>Welcome to Blert!</h1>
      <RegisterForm />
      <Link className={styles.login} href="/login">
        Already have an account? Log in
      </Link>
    </div>
  );
}

export const metadata = {
  title: 'Register',
  description: "Sign up for Old School Runescape's premium PvM analytics tool.",
};
