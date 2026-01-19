import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MAIN_LOGO } from '@/logo';
import { basicMetadata } from '@/utils/metadata';

import ForgotPasswordForm from './forgot-password-form';

import styles from '../style.module.scss';

export default async function ForgotPassword() {
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
      <h1>Reset Password</h1>
      <p className={styles.subtitle}>
        Enter your email address and we&apos;ll send you a link to reset your
        password.
      </p>
      <ForgotPasswordForm />
    </div>
  );
}

export async function generateMetadata(
  _props: object,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Forgot Password',
    description: 'Reset your Blert account password',
  });
}
