import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MAIN_LOGO } from '@/logo';
import RegisterForm from './register-form';

import styles from '../style.module.scss';

export default async function Register() {
  const session = await auth();
  if (session !== null) {
    redirect('/');
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
      <h1>Create your account</h1>
      <p className={styles.subtitle}>Join the OSRS PvM analytics community</p>
      <RegisterForm />
      <div className={styles.altLink}>
        Already have an account?<Link href="/login">Sign in</Link>
      </div>
    </div>
  );
}

export const metadata = {
  title: 'Register',
  description: "Sign up for Old School Runescape's premium PvM analytics tool.",
};
