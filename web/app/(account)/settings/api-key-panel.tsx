'use client';

import { useCallback, useRef, useState } from 'react';
import { useFormState } from 'react-dom';
import Link from 'next/link';

import {
  ApiKeyFormState,
  PlainApiKey,
  deleteApiKey,
  submitApiKeyForm,
} from '@/actions/users';
import { SubmitButton } from '@/components/button';
import Input from '@/components/input';
import LigmaTooltip from '@/components/ligma-tooltip';

import styles from './style.module.scss';

type ApiKeyProps = {
  apiKey: PlainApiKey;
  removeApiKey: (key: string) => void;
};

function ApiKey({ apiKey, removeApiKey }: ApiKeyProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [notifyKeyCopied, setNotifyKeyCopied] = useState(false);

  const copyTooltipId = `${apiKey}-tooltip`;

  return (
    <div className={styles.apiKey}>
      <LigmaTooltip open={notifyKeyCopied} tooltipId={copyTooltipId}>
        API key copied to clipboard
      </LigmaTooltip>
      <div className={styles.wrapper}>
        <input
          onBlur={() => window.getSelection()?.removeAllRanges()}
          onClick={(e) => (e.target as HTMLTextAreaElement).select()}
          readOnly
          ref={inputRef}
          type={keyVisible ? 'text' : 'password'}
          value={apiKey.key}
        />
        <div className={styles.actions}>
          <button
            aria-label={keyVisible ? 'Hide API key' : 'Show API key'}
            onClick={() => setKeyVisible(!keyVisible)}
          >
            <i
              className={`fas fa-eye${keyVisible ? '-slash' : ''}`}
              style={{
                position: 'relative',
                left: keyVisible ? -1 : 0,
              }}
            />
          </button>
          <button
            aria-label="Copy API key"
            data-tooltip-id={copyTooltipId}
            onClick={() => {
              if (!inputRef.current) {
                return;
              }

              inputRef.current.select();
              inputRef.current.setSelectionRange(0, 99999);
              navigator.clipboard.writeText(inputRef.current.value);

              setNotifyKeyCopied(true);
              window.setTimeout(() => setNotifyKeyCopied(false), 1000);
            }}
          >
            <i className={`fas ${notifyKeyCopied ? 'fa-check' : 'fa-copy'}`} />
          </button>
          <button
            aria-label="Delete API key"
            onClick={() => removeApiKey(apiKey.key)}
          >
            <i className="fas fa-trash" />
          </button>
        </div>
      </div>
      <div className={styles.keyInfo}>
        <div className={styles.account}>
          OSRS account
          <span className={styles.accountName}>{apiKey.rsn}</span>
          <Link href={`/change-name?rsn=${apiKey.rsn}`}>
            Change display name
          </Link>
        </div>
        <div className={styles.lastUsed}>
          Last used{' '}
          {apiKey.lastUsed?.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
          }) ?? 'never'}
        </div>
      </div>
    </div>
  );
}

type ApiKeyPanelProps = {
  initialApiKeys: PlainApiKey[];
};

export default function ApiKeyPanel({ initialApiKeys }: ApiKeyPanelProps) {
  const [apiKeys, setApiKeys] = useState(initialApiKeys);

  const [formState, formAction] = useFormState(
    async (formState: ApiKeyFormState, formData: FormData) =>
      submitApiKeyForm(formState, formData).then((newState) => {
        if (newState.apiKey) {
          setApiKeys([...apiKeys, newState.apiKey]);
        }
        return newState;
      }),
    {},
  );

  const removeApiKey = useCallback(
    (key: string) => {
      deleteApiKey(key).then(() => {
        setApiKeys((keys) => keys.filter((apiKey) => apiKey.key !== key));
      });
    },
    [setApiKeys],
  );

  return (
    <>
      <h2>API Keys</h2>
      <div className={styles.apiKeysList}>
        {apiKeys.length > 0 ? (
          apiKeys.map((apiKey) => (
            <ApiKey
              apiKey={apiKey}
              removeApiKey={removeApiKey}
              key={apiKey.key}
            />
          ))
        ) : (
          <p>No API keys created.</p>
        )}
      </div>
      <h3>Generate new API key</h3>
      <form action={formAction} className={styles.apiKeyForm}>
        <Input
          id="blert-api-key-rsn"
          label="OSRS username"
          maxLength={12}
          required
        />
        <SubmitButton
          className={styles.generateButton}
          disabled={apiKeys.length > 1}
        >
          Generate
        </SubmitButton>
      </form>
      {formState.error && (
        <div className={styles.formError}>{formState.error}</div>
      )}
    </>
  );
}
