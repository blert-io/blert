import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MAIN_LOGO } from '@/logo';
import { validateRedirectUrl } from '@/utils/url';

import RegisterForm from './register-form';

import styles from '../style.module.scss';

type RegisterProps = {
  searchParams: Promise<{
    next?: string;
  }>;
};

export default async function Register({ searchParams }: RegisterProps) {
  const { next } = await searchParams;
  const redirectTo = validateRedirectUrl(next);

  const session = await auth();
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
      <h1>Create your account</h1>
      <p className={styles.subtitle}>Join the OSRS PvM analytics community</p>
      <RegisterForm redirectTo={redirectTo} />
      <div className={styles.altLink}>
        Already have an account?
        <Link
          href={
            redirectTo === '/'
              ? '/login'
              : `/login?next=${encodeURIComponent(redirectTo)}`
          }
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}

export const metadata = {
  title: 'Register',
  description: "Sign up for Old School Runescape's premium PvM analytics tool.",
};
