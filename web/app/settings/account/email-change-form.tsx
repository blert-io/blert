'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { authClient } from '@/auth-client';
import Button from '@/components/button';
import Input from '@/components/input';
import { useToast } from '@/components/toast';

import styles from './email-section.module.scss';

type FormState = {
  error?: string;
  successEmail?: string;
};

async function submitEmailChange(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = (formData.get('new-email') as string).trim();
  if (!email) {
    return { error: 'Email is required' };
  }

  const result = await authClient.changeEmail({
    newEmail: email,
    callbackURL: '/email-verified?type=email_change',
  });

  if (result.data?.status === true) {
    return { successEmail: email };
  }

  return { error: result.error?.message ?? 'Failed to request email change' };
}

export default function EmailChangeForm() {
  const [state, action, isPending] = useActionState(submitEmailChange, {});
  const [inputValue, setInputValue] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const showToast = useToast();

  useEffect(() => {
    if (state.successEmail) {
      showToast('Verification email sent to your new address', 'success');
      setInputValue('');
      formRef.current?.reset();
    }
  }, [state.successEmail, showToast]);

  return (
    <div className={styles.emailForm}>
      <form ref={formRef} action={action}>
        <Input
          id="new-email"
          type="email"
          label="New email address"
          labelBg="var(--blert-surface-dark)"
          faIcon="fa-solid fa-envelope"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          required
          fluid
        />
        {state.error && <p className={styles.error}>{state.error}</p>}
        <Button type="submit" disabled={isPending || !inputValue.trim()}>
          {isPending ? 'Sending...' : 'Send Verification Email'}
        </Button>
      </form>
    </div>
  );
}
