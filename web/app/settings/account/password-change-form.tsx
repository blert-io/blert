'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { authClient } from '@/auth-client';
import Button from '@/components/button';
import Input from '@/components/input';
import { useToast } from '@/components/toast';

import styles from '../style.module.scss';

function FormFields() {
  const { pending } = useFormStatus();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const passwordTooShort = newPassword.length > 0 && newPassword.length < 8;
  const passwordUnconfirmed =
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    newPassword !== confirmPassword;

  const canSubmit =
    newPassword.length >= 8 &&
    confirmPassword.length > 0 &&
    !passwordUnconfirmed;

  return (
    <>
      <Input
        disabled={pending}
        fluid
        id="current-password"
        label="Current Password"
        labelBg="var(--blert-surface-dark)"
        type="password"
        required
        faIcon="fa-solid fa-lock"
      />
      <Input
        disabled={pending}
        fluid
        id="new-password"
        label="New Password"
        labelBg="var(--blert-surface-dark)"
        type="password"
        required
        faIcon="fa-solid fa-key"
        invalid={passwordTooShort}
        errorMessage="Password must be at least 8 characters"
        minLength={8}
        onChange={(e) => setNewPassword(e.target.value)}
        value={newPassword}
      />
      <Input
        disabled={pending}
        fluid
        id="confirm-password"
        label="Confirm New Password"
        labelBg="var(--blert-surface-dark)"
        type="password"
        required
        faIcon="fa-solid fa-key"
        invalid={passwordUnconfirmed}
        errorMessage="Passwords do not match"
        onChange={(e) => setConfirmPassword(e.target.value)}
        value={confirmPassword}
      />
      <Button disabled={!canSubmit} loading={pending} type="submit" fluid>
        Change Password
      </Button>
    </>
  );
}

export default function PasswordChangeForm() {
  const showToast = useToast();
  const [formKey, setFormKey] = useState(0);

  const [error, formAction] = useActionState(
    async (_state: string | null, formData: FormData) => {
      const currentPassword = (formData.get('current-password') ??
        '') as string;
      const newPassword = (formData.get('new-password') ?? '') as string;

      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      });

      if (result.error) {
        return result.error.message ?? 'An error occurred, please try again.';
      }

      showToast('Password changed successfully!', 'success');
      setFormKey((prev) => prev + 1);
      return null;
    },
    null,
  );

  return (
    <form key={formKey} action={formAction}>
      <FormFields />
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
