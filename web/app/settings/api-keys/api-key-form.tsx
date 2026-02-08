'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  ApiKeyFormState,
  ApiKeyWithUsername,
  submitApiKeyForm,
} from '@/actions/users';
import Button from '@/components/button';
import Input from '@/components/input';

import styles from '../style.module.scss';

function FormFields({ existingPlayers }: { existingPlayers: Set<string> }) {
  const { pending } = useFormStatus();

  const [rsn, setRsn] = useState('');

  const existingKey = existingPlayers.has(rsn.toLowerCase().trim());
  const canSubmit = rsn.length > 0 && !existingKey;

  return (
    <>
      <Input
        disabled={pending}
        fluid
        id="blert-api-key-rsn"
        label="OSRS username"
        labelBg="var(--blert-surface-dark)"
        maxLength={12}
        required
        faIcon="fa-solid fa-user"
        value={rsn}
        onChange={(e) => setRsn(e.target.value)}
        invalid={existingKey}
        errorMessage="You already have an API key for this player"
      />
      <Button disabled={!canSubmit} loading={pending} type="submit" fluid>
        Generate API key
      </Button>
    </>
  );
}

export default function ApiKeyForm({
  onApiKeyGenerated,
  existingPlayers,
}: {
  onApiKeyGenerated: (apiKey: ApiKeyWithUsername) => void;
  existingPlayers: Set<string>;
}) {
  const [formKey, setFormKey] = useState(0);
  const [state, formAction] = useActionState(
    async (formState: ApiKeyFormState, formData: FormData) =>
      submitApiKeyForm(formState, formData).then((newState) => {
        if (newState.apiKey) {
          onApiKeyGenerated(newState.apiKey);
          setFormKey((k) => k + 1);
        }
        return newState;
      }),
    {},
  );

  return (
    <form action={formAction}>
      <FormFields key={formKey} existingPlayers={existingPlayers} />
      {state.error && <p className={styles.error}>{state.error}</p>}
    </form>
  );
}
