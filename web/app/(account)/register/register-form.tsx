'use client';

import { useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

import { RegistrationErrors, register, userExists } from '../../actions/users';
import Button from '../../components/button';
import Input from '../../components/input';

import styles from './style.module.scss';

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
        fluid
        id="blert-username"
        invalid={usernameExists || !validUsername}
        label="Username"
        minLength={2}
        maxLength={24}
        onChange={(e) => {
          setUsername(e.target.value);
          setUsernameExists(false);

          if (usernameCheckTimeout.current) {
            window.clearTimeout(usernameCheckTimeout.current);
          }

          if (e.target.value.length > 0) {
            usernameCheckTimeout.current = window.setTimeout(async () => {
              const exists = await userExists(e.target.value);
              setUsernameExists(exists);
              usernameCheckTimeout.current = null;
            }, 500);
          }
        }}
        required
        value={username}
      />
      <Input
        disabled={pending}
        errorMessage={errors?.email?.[0]}
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
        fluid
        id="blert-password-confirm"
        label="Confirm password"
        invalid={passwordUnconfirmed}
        onChange={(e) => setPasswordConfirm(e.target.value)}
        required
        type="password"
        value={passwordConfirm}
      />
      <Button disabled={!canSubmit} loading={pending} type="submit">
        Create your account
      </Button>
    </>
  );
}

export default function RegisterForm() {
  const [errors, formAction] = useFormState(register, null);

  return (
    <form action={formAction} className={styles.registerForm}>
      <FormFields errors={errors} />
      {errors?.overall && <p className={styles.error}>{errors.overall}</p>}
    </form>
  );
}
