import { ResolvingMetadata } from 'next';
import { headers } from 'next/headers';
import Image from 'next/image';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { MAIN_LOGO } from '@/logo';
import { basicMetadata } from '@/utils/metadata';

import ResetPasswordForm from './reset-password-form';
import VerificationResult from '../verification-result';

import styles from '../style.module.scss';

type ResetPasswordProps = {
  searchParams: Promise<{
    token?: string;
    error?: string;
  }>;
};

export default async function ResetPassword({
  searchParams,
}: ResetPasswordProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session !== null) {
    redirect('/');
  }

  const { token, error } = await searchParams;

  if (error) {
    return (
      <VerificationResult
        error={{
          title: 'Link Invalid',
          message:
            'This password reset link is invalid or has expired. Please request a new one.',
          link: {
            href: '/forgot-password',
            label: 'Request New Link',
            icon: 'fas fa-arrow-left',
          },
        }}
      />
    );
  }

  if (!token) {
    return (
      <VerificationResult
        error={{
          title: 'Invalid Link',
          message:
            'This password reset link is invalid. Please request a new one.',
          link: {
            href: '/forgot-password',
            label: 'Request New Link',
            icon: 'fas fa-arrow-left',
          },
        }}
      />
    );
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
      <h1>Set New Password</h1>
      <p className={styles.subtitle}>Enter your new password below.</p>
      <ResetPasswordForm token={token} />
    </div>
  );
}

export async function generateMetadata(
  _props: object,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Reset Password',
    description: 'Set a new password for your Blert account',
  });
}
