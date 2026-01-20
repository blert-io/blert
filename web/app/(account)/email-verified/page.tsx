import { ResolvingMetadata } from 'next';

import { basicMetadata } from '@/utils/metadata';

import VerificationResult from '../verification-result';

type VerificationType = 'new_email' | 'email_change';

type EmailVerifiedProps = {
  searchParams: Promise<{
    type?: string;
    error?: string;
  }>;
};

export default async function EmailVerified({
  searchParams,
}: EmailVerifiedProps) {
  const { type, error } = await searchParams;

  if (type !== 'new_email' && type !== 'email_change') {
    return (
      <VerificationResult
        error={{
          title: 'Invalid Page',
          message:
            'This page can only be accessed through an email verification link.',
          link: {
            href: '/',
            label: 'Go to Home',
            icon: 'fas fa-home',
          },
        }}
      />
    );
  }

  const verificationType: VerificationType = type;

  if (error) {
    if (error === 'invalid_token') {
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

    return (
      <VerificationResult
        error={{
          title: 'Verification Failed',
          message:
            'Something went wrong. Please check your email for the correct link or request a new one.',
          link: {
            href: '/settings/account',
            label: 'Go to Settings',
            icon: 'fas fa-cog',
          },
        }}
      />
    );
  }

  const successMessages: Record<
    VerificationType,
    { title: string; message: string }
  > = {
    new_email: {
      title: 'Email Verified!',
      message:
        'Your email address has been verified. You can now use all features of your Blert account.',
    },
    email_change: {
      title: 'Email Changed!',
      message: 'Your email address has been updated successfully.',
    },
  };

  return (
    <VerificationResult
      success={{
        ...successMessages[verificationType],
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

export async function generateMetadata(
  _props: object,
  parent: ResolvingMetadata,
) {
  return basicMetadata(await parent, {
    title: 'Email Verified',
    description: 'Email verification result',
  });
}
