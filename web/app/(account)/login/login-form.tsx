'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';

import { login } from '@/actions/users';
import Input from '@/components/input';
import Button from '@/components/button';

import styles from './style.module.scss';
import { getSession } from 'next-auth/react';

function FormFields() {
  const { pending } = useFormStatus();

  return (
    <>
      <Input
        disabled={pending}
        fluid
        id="blert-username"
        label="Username"
        maxLength={24}
        required
      />
      <Input
        disabled={pending}
        fluid
        id="blert-password"
        label="Password"
        required
        type="password"
      />
      <Button loading={pending} type="submit">
        Log In
      </Button>
    </>
  );
}

export default function LoginForm() {
  const router = useRouter();

  const [error, formAction] = useFormState(
    async (state: string | null, formData: FormData) => {
      const error = await login(state, formData);
      if (error === null) {
        await getSession();
        router.push('/');
      }
      return error;
    },
    null,
  );

  return (
    <form action={formAction} className={styles.loginForm}>
      <FormFields />
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
