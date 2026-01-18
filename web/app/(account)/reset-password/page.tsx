import { ResolvingMetadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';

import { validateResetToken } from '@/actions/email';
import { auth } from '@/auth';
import { MAIN_LOGO } from '@/logo';
import { basicMetadata } from '@/utils/metadata';

import ResetPasswordForm from './reset-password-form';
import VerificationResult from '../verification-result';

import styles from '../style.module.scss';

type ResetPasswordProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  expired: 'This password reset link has expired. Please request a new one.',
  already_used:
    'This password reset link has already been used. Please request a new one if you still need to reset your password.',
  invalid_token:
    'This password reset link is invalid. Please request a new one.',
};

export default async function ResetPassword({
  searchParams,
}: ResetPasswordProps) {
  const session = await auth();
  if (session !== null) {
    redirect('/');
  }

  const { token } = await searchParams;

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

  const validation = await validateResetToken(token);

  if (!validation.success) {
    return (
      <VerificationResult
        error={{
          title: 'Link Invalid',
          message:
            ERROR_MESSAGES[validation.error] ?? ERROR_MESSAGES.invalid_token,
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
