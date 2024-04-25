'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';

import { submitNameChangeForm } from '@/actions/change-name';
import { SubmitButton } from '@/components/button';
import Input from '@/components/input';

import styles from './style.module.scss';

type ChangeNameFormProps = {
  initialOldName?: string;
};

export function ChangeNameForm({ initialOldName }: ChangeNameFormProps) {
  const [oldName, setOldName] = useState(initialOldName ?? '');
  const [newName, setNewName] = useState('');

  const [error, formAction] = useFormState(submitNameChangeForm, null);

  return (
    <form action={formAction}>
      <Input
        fluid
        id="blert-old-name"
        label="Old Name"
        onChange={(e) => setOldName(e.target.value)}
        required
        value={oldName}
      />
      <Input
        fluid
        id="blert-new-name"
        label="New Name"
        onChange={(e) => setNewName(e.target.value)}
        required
        value={newName}
      />
      <SubmitButton fluid>Change name</SubmitButton>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
