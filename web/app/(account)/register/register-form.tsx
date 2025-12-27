'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { RegistrationErrors, register, userExists } from '@/actions/users';
import Button from '@/components/button';
import Input from '@/components/input';

import styles from '../style.module.scss';

function FormFields({ errors }: { errors: RegistrationErrors | null }) {
  const { pending } = useFormStatus();

  const [username, setUsername] = useState('');
  const [usernameExists, setUsernameExists] = useState(false);

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const usernameCheckTimeout = useRef<number | null>(null);

  const validUsername = /^[a-zA-Z0-9_-]*$/.test(username);

  const passwordUnconfirmed =
    password.length > 0 &&
    passwordConfirm.length > 0 &&
    password !== passwordConfirm;

  const canSubmit =
    username.length > 0 &&
    validUsername &&
    password.length > 0 &&
    !usernameExists &&
    !passwordUnconfirmed;

  return (
    <>
      <Input
        disabled={pending}
        errorMessage={
          usernameExists
            ? 'Username is already taken'
            : 'Only letters, numbers, hyphens, and underscores'
        }
        faIcon="fa-solid fa-user"
        fluid
        id="blert-username"
        invalid={usernameExists || !validUsername}
        label="Username"
        minLength={2}
        maxLength={24}
        onChange={(e) => {
          const nextUsername = e.target.value;

          setUsername(nextUsername);
          setUsernameExists(false);

          if (usernameCheckTimeout.current) {
            window.clearTimeout(usernameCheckTimeout.current);
          }

          if (nextUsername.length > 0) {
            usernameCheckTimeout.current = window.setTimeout(() => {
              usernameCheckTimeout.current = null;
              void userExists(nextUsername).then((exists) => {
                setUsernameExists(exists);
              });
            }, 500);
          }
        }}
        required
        value={username}
      />
      <Input
        disabled={pending}
        errorMessage={errors?.email?.[0]}
        faIcon="fa-solid fa-envelope"
        fluid
        id="blert-email"
        invalid={errors?.email !== undefined}
        label="Email address"
        required
        type="email"
      />
      <Input
        disabled={pending}
        errorMessage={errors?.password?.[0]}
        faIcon="fa-solid fa-lock"
        fluid
        id="blert-password"
        invalid={errors?.password !== undefined}
        label="Password"
        minLength={8}
        onChange={(e) => setPassword(e.target.value)}
        required
        type="password"
        value={password}
      />
      <Input
        disabled={pending}
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
  const [errors, formAction] = useActionState(register, null);

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <FormFields errors={errors} />
      {errors?.overall && <p className={styles.error}>{errors.overall}</p>}
    </form>
  );
}
