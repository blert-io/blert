'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { requestEmailChange, RequestEmailChangeResult } from '@/actions/email';
import Button from '@/components/button';
import Input from '@/components/input';
import { useToast } from '@/components/toast';

import styles from './email-section.module.scss';

type EmailChangeFormProps = {
  onSuccess?: (email: string) => void;
};

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

  const result: RequestEmailChangeResult = await requestEmailChange(email);

  if (!result.success) {
    switch (result.error) {
      case 'rate_limited':
        return {
          error: `Please wait ${result.retryAfter} seconds before trying again`,
        };
      case 'email_in_use':
        return { error: 'This email address is already in use' };
      case 'same_email':
        return { error: 'This is already your current email address' };
      case 'invalid_email':
        return { error: 'Please enter a valid email address' };
      case 'send_failed':
        return {
          error: 'Failed to send verification email. Please try again.',
        };
    }
  }

  return { successEmail: email };
}

export default function EmailChangeForm({ onSuccess }: EmailChangeFormProps) {
  const [state, action, isPending] = useActionState(submitEmailChange, {});
  const [inputValue, setInputValue] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const showToast = useToast();

  useEffect(() => {
    if (state.successEmail) {
      showToast('Verification email sent to your new address', 'success');
      setInputValue('');
      formRef.current?.reset();
      onSuccessRef.current?.(state.successEmail);
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
