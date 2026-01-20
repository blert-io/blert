'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useCallback, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { authClient } from '@/auth-client';
import Button from '@/components/button';
import Input from '@/components/input';
import { validateRedirectUrl } from '@/utils/url';

import styles from '../style.module.scss';

const USERNAME_REGEX = /^[a-zA-Z0-9_-]*$/;

function isValidUsername(username: string): boolean {
  return (
    username.length >= 2 &&
    username.length <= 24 &&
    USERNAME_REGEX.test(username)
  );
}

function FormFields() {
  const { pending } = useFormStatus();

  const [username, setUsername] = useState('');
  const [usernameExists, setUsernameExists] = useState(false);

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const usernameCheckTimeout = useRef<number | null>(null);
  const usernameCheckId = useRef(0);

  const checkUsernameAvailable = useCallback((username: string) => {
    if (usernameCheckTimeout.current) {
      window.clearTimeout(usernameCheckTimeout.current);
    }

    if (!isValidUsername(username)) {
      return;
    }

    const checkId = ++usernameCheckId.current;

    usernameCheckTimeout.current = window.setTimeout(() => {
      usernameCheckTimeout.current = null;

      void authClient
        .isUsernameAvailable({ username })
        .then(({ data, error }) => {
          if (checkId !== usernameCheckId.current) {
            return;
          }
          if (!error) {
            setUsernameExists(!data?.available);
          }
        });
    }, 500);
  }, []);

  const validUsername = isValidUsername(username);

  const passwordUnconfirmed =
    password.length > 0 &&
    passwordConfirm.length > 0 &&
    password !== passwordConfirm;

  const canSubmit =
    validUsername &&
    password.length > 0 &&
    !usernameExists &&
    !passwordUnconfirmed;

  const getUsernameErrorMessage = () => {
    if (usernameExists) {
      return 'Username is already taken';
    }
    if (!USERNAME_REGEX.test(username)) {
      return 'Only letters, numbers, hyphens, and underscores';
    }
    if (!validUsername) {
      return 'Username must be between 2 and 24 characters';
    }
    return undefined;
  };

  return (
    <>
      <Input
        disabled={pending}
        errorMessage={getUsernameErrorMessage()}
        faIcon="fa-solid fa-user"
        fluid
        id="blert-username"
        invalid={usernameExists || (username.length > 0 && !validUsername)}
        label="Username"
        minLength={2}
        maxLength={24}
        onChange={(e) => {
          const nextUsername = e.target.value;
          setUsername(nextUsername);
          setUsernameExists(false);
          checkUsernameAvailable(nextUsername);
        }}
        required
        value={username}
      />
      <Input
        disabled={pending}
        faIcon="fa-solid fa-envelope"
        fluid
        id="blert-email"
        label="Email address"
        required
        type="email"
      />
      <Input
        disabled={pending}
        errorMessage="Password must be at least 8 characters"
        faIcon="fa-solid fa-lock"
        fluid
        id="blert-password"
        invalid={password.length > 0 && password.length < 8}
        label="Password"
        minLength={8}
        onChange={(e) => setPassword(e.target.value)}
        required
        type="password"
        value={password}
      />
      <Input
        disabled={pending}
        errorMessage="Passwords do not match"
        faIcon="fa-solid fa-lock"
        fluid
        id="blert-password-confirm"
        label="Confirm password"
        invalid={passwordUnconfirmed}
        onChange={(e) => setPasswordConfirm(e.target.value)}
        required
        type="password"
        value={passwordConfirm}
      />
      <Button disabled={!canSubmit} fluid loading={pending} type="submit">
        Create your account
      </Button>
    </>
  );
}

export default function RegisterForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();

  const [error, formAction] = useActionState(
    async (_state: string | null, formData: FormData) => {
      const username = (formData.get('blert-username') ?? '') as string;
      const email = (formData.get('blert-email') ?? '') as string;
      const password = (formData.get('blert-password') ?? '') as string;

      const { error } = await authClient.signUp.email({
        name: username,
        username,
        email,
        password,
        callbackURL: '/email-verified?type=new_email',
      });

      if (error) {
        return error?.message ?? 'An error occurred, please try again.';
      }

      router.push(validateRedirectUrl(redirectTo));
      return null;
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
