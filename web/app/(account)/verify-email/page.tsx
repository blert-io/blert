import { ResolvingMetadata } from 'next';

import { verifyEmail } from '@/actions/email';
import { basicMetadata } from '@/utils/metadata';

import VerificationResult from '../verification-result';

type VerifyEmailProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  expired:
    'This verification link has expired. Please request a new one from your account settings.',
  already_used:
    'This verification link has already been used. If you need to verify a different email, please request a new link.',
  invalid_token:
    'This verification link is invalid. Please check your email for the correct link.',
};

export default async function VerifyEmail({ searchParams }: VerifyEmailProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <VerificationResult
        error={{
          title: 'Invalid Link',
          message:
            'This verification link is invalid. Please check your email for the correct link.',
          link: {
            href: '/login',
            label: 'Back to Login',
            icon: 'fas fa-arrow-left',
          },
        }}
      />
    );
  }

  const result = await verifyEmail(token);
  const success = result.success || result.error === 'already_verified';

  if (success) {
    return (
      <VerificationResult
        success={{
          title: 'Email Verified!',
          message:
            'Your email address has been verified. You can now use all features of your Blert account.',
          link: {
            href: '/',
            label: 'Go to Home',
            icon: 'fas fa-home',
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
          href: '/login',
          label: 'Back to Login',
          icon: 'fas fa-arrow-left',
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
    title: 'Verify Email',
    description: "Verify your Blert account's email address",
  });
}
