'use client';

import { useState } from 'react';

import { ApiKeyWithUsername } from '@/actions/users';

import ApiKey from './api-key';
import ApiKeyForm from './api-key-form';

import styles from './style.module.scss';

type ApiKeysSectionProps = {
  initialApiKeys: ApiKeyWithUsername[];
};

export default function ApiKeysSection({
  initialApiKeys,
}: ApiKeysSectionProps) {
  const [apiKeys, setApiKeys] = useState(initialApiKeys);

  const handleDelete = (deletedKey: ApiKeyWithUsername) => {
    setApiKeys(apiKeys.filter((key) => key.id !== deletedKey.id));
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>API Keys</h2>
        <p className={styles.description}>
          API keys are used to authenticate your RuneLite plugin with Blert.
          Generate a new key and paste it into your plugin settings.
        </p>
      </div>

      <div className={styles.apiKeys}>
        {apiKeys.length === 0 ? (
          <div className={styles.emptyState}>
            <i className="fas fa-key" />
            <h3>No API Keys</h3>
            <p>
              You haven&apos;t generated any API keys yet. Generate a key below
              to start using the Blert plugin.
            </p>
          </div>
        ) : (
          apiKeys.map((key) => (
            <div key={key.id} className={styles.apiKey}>
              <ApiKey apiKey={key} onDelete={() => handleDelete(key)} />
            </div>
          ))
        )}
      </div>

      <div className={styles.generateKey}>
        <h3>Generate new API key</h3>
        <ApiKeyForm
          onApiKeyGenerated={(key) => setApiKeys((prev) => [...prev, key])}
        />
      </div>
    </section>
  );
}
