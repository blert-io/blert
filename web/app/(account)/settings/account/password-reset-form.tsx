'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { PasswordResetErrors, changePassword } from '@/actions/users';
import Button from '@/components/button';
import Input from '@/components/input';
import { useToast } from '@/components/toast';

import styles from '../style.module.scss';

function FormFields({ errors }: { errors: PasswordResetErrors | null }) {
  const { pending } = useFormStatus();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

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
        labelBg="var(--nav-bg)"
        type="password"
        required
        faIcon="fa-solid fa-lock"
        invalid={!!errors?.currentPassword}
        errorMessage={errors?.currentPassword?.[0]}
      />
      <Input
        disabled={pending}
        fluid
        id="new-password"
        label="New Password"
        labelBg="var(--nav-bg)"
        type="password"
        required
        faIcon="fa-solid fa-key"
        invalid={!!errors?.newPassword}
        errorMessage={errors?.newPassword?.[0]}
        minLength={8}
        onChange={(e) => setNewPassword(e.target.value)}
        value={newPassword}
      />
      <Input
        disabled={pending}
        fluid
        id="confirm-password"
        label="Confirm New Password"
        labelBg="var(--nav-bg)"
        type="password"
        required
        faIcon="fa-solid fa-key"
        invalid={passwordUnconfirmed || !!errors?.confirmPassword}
        errorMessage={
          passwordUnconfirmed
            ? 'Passwords do not match'
            : errors?.confirmPassword?.[0]
        }
        onChange={(e) => setConfirmPassword(e.target.value)}
        value={confirmPassword}
      />
      <Button disabled={!canSubmit} loading={pending} type="submit" fluid>
        Change Password
      </Button>
    </>
  );
}

export default function PasswordResetForm() {
  const showToast = useToast();
  const [formKey, setFormKey] = useState(0);

  const [state, formAction] = useActionState(
    async (formState: PasswordResetErrors | null, formData: FormData) => {
      const result = await changePassword(formState, formData);

      if (result === null) {
        showToast('Password changed successfully!', 'success');
        // Reset form.
        setFormKey((prev) => prev + 1);
        return null;
      }

      return result;
    },
    null,
  );

  return (
    <form key={formKey} action={formAction}>
      <FormFields errors={state} />
      {state?.overall && <p className={styles.error}>{state.overall}</p>}
    </form>
  );
}
