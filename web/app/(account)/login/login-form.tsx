'use client';

import { getSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { login } from '@/actions/users';
import Input from '@/components/input';
import Button from '@/components/button';

import styles from '../style.module.scss';

function FormFields() {
  const { pending } = useFormStatus();

  return (
    <>
      <Input
        autoFocus
        disabled={pending}
        fluid
        id="blert-username"
        label="Username"
        maxLength={24}
        required
        faIcon="fa-solid fa-user"
      />
      <Input
        disabled={pending}
        fluid
        id="blert-password"
        label="Password"
        required
        type="password"
        faIcon="fa-solid fa-lock"
      />
      <Button loading={pending} type="submit" fluid>
        Sign in
      </Button>
    </>
  );
}

export default function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();

  const [error, formAction] = useActionState(
    async (state: string | null, formData: FormData) => {
      const error = await login(state, formData);
      if (error === null) {
        await getSession();
        router.push(redirectTo ?? '/');
      }
      return error;
    },
    null,
  );

  return (
    <form action={formAction} className={styles.form}>
      <FormFields />
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
