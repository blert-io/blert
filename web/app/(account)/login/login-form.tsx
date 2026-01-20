'use client';

import { useRouter } from 'next/navigation';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { authClient } from '@/auth-client';
import Input from '@/components/input';
import Button from '@/components/button';
import { validateRedirectUrl } from '@/utils/url';

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
    async (_state: string | null, formData: FormData) => {
      const username = (formData.get('blert-username') ?? '') as string;
      const password = (formData.get('blert-password') ?? '') as string;

      const { error } = await authClient.signIn.username({
        username,
        password,
      });
      if (!error) {
        router.push(validateRedirectUrl(redirectTo));
        return null;
      }

      return error?.message ?? 'Invalid username or password';
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
