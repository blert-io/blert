import { ResolvingMetadata } from 'next';

import { verifyEmailChange } from '@/actions/email';
import { basicMetadata } from '@/utils/metadata';

import VerificationResult from '../verification-result';

type VerifyEmailChangeProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  expired:
    'This verification link has expired. Please request a new email change from your account settings.',
  already_used:
    'This verification link has already been used. If you need to change your email again, please request a new link.',
  email_in_use:
    'This email address is now in use by another account. Please try a different email address.',
  invalid_token:
    'This verification link is invalid. Please check your email for the correct link.',
};

export default async function VerifyEmailChange({
  searchParams,
}: VerifyEmailChangeProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <VerificationResult
        error={{
          title: 'Invalid Link',
          message:
            'This verification link is invalid. Please check your email for the correct link.',
          link: {
            href: '/settings/account',
            label: 'Go to Settings',
            icon: 'fas fa-cog',
          },
        }}
      />
    );
  }

  const result = await verifyEmailChange(token);

  if (result.success) {
    return (
      <VerificationResult
        success={{
          title: 'Email Changed!',
          message: `Your email address has been changed to ${result.newEmail}.`,
          link: {
            href: '/settings/account',
            label: 'Go to Settings',
            icon: 'fas fa-cog',
          },
        }}
        refreshSession
      />
    );
  }

  return (
    <VerificationResult
      error={{
        title: 'Verification Failed',
        message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.invalid_token,
        link: {
          href: '/settings/account',
          label: 'Go to Settings',
          icon: 'fas fa-cog',
        },
      }}
    />
  );
}

export async function generateMetadata(
  _props: object,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Verify Email Change',
    description: 'Verify your new email address',
  });
}
