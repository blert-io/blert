'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { authClient } from '@/auth-client';
import Button from '@/components/button';
import Input from '@/components/input';

import styles from '../style.module.scss';

function FormFields() {
  const { pending } = useFormStatus();

  return (
    <>
      <Input
        autoFocus
        disabled={pending}
        fluid
        id="blert-email"
        label="Email"
        required
        type="email"
        faIcon="fa-solid fa-envelope"
      />
      <Button loading={pending} type="submit" fluid>
        Send Reset Link
      </Button>
    </>
  );
}

type FormState = {
  submitted: boolean;
  error?: string;
};

export default function ForgotPasswordForm() {
  const [state, formAction] = useActionState(
    async (_state: FormState, formData: FormData): Promise<FormState> => {
      const email = (formData.get('blert-email') as string).trim();

      if (!email) {
        return {
          submitted: false,
          error: 'Please enter a valid email address.',
        };
      }

      // Always show success to prevent email enumeration.
      await authClient.requestPasswordReset({
        email,
        redirectTo: '/reset-password',
      });

      return { submitted: true };
    },
    { submitted: false },
  );

  if (state.submitted) {
    return (
      <div className={styles.form}>
        <p className={styles.success}>
          If an account exists with that email, you&apos;ll receive a password
          reset link shortly. Please check your inbox and spam folder.
        </p>
        <Link href="/login" className={styles.actionButton}>
          <i className="fas fa-arrow-left" />
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className={styles.form}>
      <FormFields />
      {state.error && <p className={styles.error}>{state.error}</p>}
      <div className={styles.altLink}>
        Remember your password?
        <Link href="/login">Sign in</Link>
      </div>
    </form>
  );
}
