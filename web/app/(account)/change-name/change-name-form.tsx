'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { submitNameChangeForm } from '@/actions/change-name';
import Button from '@/components/button';
import Input from '@/components/input';
import PlayerSearch from '@/components/player-search';

import styles from './style.module.scss';

type ChangeNameFormProps = {
  initialOldName?: string;
};

function FormFields({ initialOldName }: { initialOldName?: string }) {
  const { pending } = useFormStatus();
  const [oldName, setOldName] = useState(initialOldName ?? '');
  const [newName, setNewName] = useState('');

  return (
    <>
      <PlayerSearch
        autoFocus={!initialOldName}
        disabled={pending}
        faIcon="fa-solid fa-user"
        fluid
        id="blert-old-name"
        label="Previous RSN"
        maxLength={12}
        onChange={setOldName}
        onSelection={setOldName}
        required
        value={oldName}
      />
      <Input
        autoFocus={!!initialOldName}
        disabled={pending}
        faIcon="fa-solid fa-user"
        fluid
        id="blert-new-name"
        label="New RSN"
        maxLength={12}
        onChange={(e) => setNewName(e.target.value)}
        required
        value={newName}
      />
      <Button loading={pending} type="submit" fluid>
        Submit name change
      </Button>
    </>
  );
}

export function ChangeNameForm({ initialOldName }: ChangeNameFormProps) {
  const [error, formAction] = useActionState(submitNameChangeForm, null);

  return (
    <form action={formAction}>
      <FormFields initialOldName={initialOldName} />
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
