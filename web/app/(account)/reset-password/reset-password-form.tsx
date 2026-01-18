'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { resetPassword } from '@/actions/email';
import Button from '@/components/button';
import Input from '@/components/input';

import styles from '../style.module.scss';

type FormFieldsProps = {
  password: string;
  confirmPassword: string;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
};

function FormFields({
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
}: FormFieldsProps) {
  const { pending } = useFormStatus();

  const passwordTooShort = password.length > 0 && password.length < 8;
  const passwordUnconfirmed =
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password !== confirmPassword;

  const canSubmit =
    password.length >= 8 && confirmPassword.length > 0 && !passwordUnconfirmed;

  return (
    <>
      <Input
        autoFocus
        disabled={pending}
        fluid
        id="new-password"
        label="New Password"
        minLength={8}
        required
        type="password"
        faIcon="fa-solid fa-lock"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        invalid={passwordTooShort}
        errorMessage="Must be at least 8 characters"
      />
      <Input
        disabled={pending}
        fluid
        id="confirm-password"
        label="Confirm Password"
        minLength={8}
        required
        type="password"
        faIcon="fa-solid fa-lock"
        value={confirmPassword}
        onChange={(e) => onConfirmPasswordChange(e.target.value)}
        invalid={passwordUnconfirmed}
      />
      <Button loading={pending} type="submit" fluid disabled={!canSubmit}>
        Reset Password
      </Button>
    </>
  );
}

type FormState = {
  success: boolean;
  error?: string;
};

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [state, formAction] = useActionState(
    async (_state: FormState, formData: FormData): Promise<FormState> => {
      const newPassword = formData.get('new-password') as string;
      const confirm = formData.get('confirm-password') as string;

      if (newPassword !== confirm) {
        return { success: false, error: 'Passwords do not match.' };
      }

      if (newPassword.length < 8) {
        return {
          success: false,
          error: 'Password must be at least 8 characters.',
        };
      }

      if (newPassword.length > 96) {
        return {
          success: false,
          error: 'Password must be at most 96 characters.',
        };
      }

      const result = await resetPassword(token, newPassword);

      if (!result.success) {
        switch (result.error) {
          case 'expired':
            return {
              success: false,
              error: 'This reset link has expired. Please request a new one.',
            };
          case 'already_used':
            return {
              success: false,
              error:
                'This reset link has already been used. Please request a new one.',
            };
          case 'invalid_password':
            return {
              success: false,
              error: 'Password must be between 8 and 96 characters.',
            };
          case 'invalid_token':
          default:
            return {
              success: false,
              error: 'This reset link is invalid. Please request a new one.',
            };
        }
      }

      return { success: true };
    },
    { success: false },
  );

  if (state.success) {
    return (
      <div className={styles.form}>
        <p className={styles.success}>
          Your password has been reset successfully. You can now sign in with
          your new password.
        </p>
        <Link href="/login" className={styles.actionButton}>
          <i className="fas fa-right-to-bracket" />
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className={styles.form}>
      <FormFields
        password={password}
        confirmPassword={confirmPassword}
        onPasswordChange={setPassword}
        onConfirmPasswordChange={setConfirmPassword}
      />
      {state.error && <p className={styles.error}>{state.error}</p>}
    </form>
  );
}
