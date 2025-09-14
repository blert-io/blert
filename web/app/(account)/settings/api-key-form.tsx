'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  ApiKeyFormState,
  ApiKeyWithUsername,
  submitApiKeyForm,
} from '@/actions/users';
import Button from '@/components/button';
import Input from '@/components/input';

import styles from './style.module.scss';

function FormFields() {
  const { pending } = useFormStatus();

  return (
    <>
      <Input
        disabled={pending}
        fluid
        id="blert-api-key-rsn"
        label="OSRS username"
        labelBg="var(--nav-bg)"
        maxLength={12}
        required
        faIcon="fa-solid fa-user"
      />
      <Button loading={pending} type="submit" fluid>
        Generate API key
      </Button>
    </>
  );
}

export default function ApiKeyForm({
  onApiKeyGenerated,
}: {
  onApiKeyGenerated: (apiKey: ApiKeyWithUsername) => void;
}) {
  const [state, formAction] = useActionState(
    async (formState: ApiKeyFormState, formData: FormData) =>
      submitApiKeyForm(formState, formData).then((newState) => {
        if (newState.apiKey) {
          onApiKeyGenerated(newState.apiKey);
        }
        return newState;
      }),
    {},
  );

  return (
    <form action={formAction}>
      <FormFields />
      {state.error && <p className={styles.error}>{state.error}</p>}
    </form>
  );
}
