'use client';

import { useState } from 'react';

import { ApiKeyWithUsername, deleteApiKey } from '@/actions/users';
import Button from '@/components/button';
import { Modal } from '@/components/modal/modal';
import { useToast } from '@/components/toast';

import styles from '../style.module.scss';

type ApiKeyProps = {
  apiKey: ApiKeyWithUsername;
  onDelete: () => void;
};

export default function ApiKey({ apiKey, onDelete }: ApiKeyProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const showToast = useToast();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(apiKey.key);
    showToast('API key copied to clipboard');
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteApiKey(apiKey.key);
      onDelete();
    } catch {
      showToast('Failed to delete API key');
    }
    setIsDeleting(false);
    setShowDeleteModal(false);
  };

  return (
    <>
      <div className={styles.keyInfo}>
        <div className={styles.keyValue}>
          {isVisible ? (
            <span className={styles.key}>{apiKey.key}</span>
          ) : (
            <span className={styles.dots}>{'•'.repeat(32)}</span>
          )}
          <div className={styles.actions}>
            <button
              title={isVisible ? 'Hide key' : 'Show key'}
              className={styles.action}
              onClick={() => setIsVisible(!isVisible)}
            >
              <i className={`fa-solid fa-${isVisible ? 'eye-slash' : 'eye'}`} />
            </button>
            <button
              title="Copy key"
              className={styles.action}
              onClick={() => void handleCopy()}
            >
              <i className="fa-solid fa-copy" />
            </button>
            <button
              title="Delete key"
              className={styles.action}
              onClick={() => setShowDeleteModal(true)}
              disabled={isDeleting}
            >
              <i className="fa-solid fa-trash" />
            </button>
          </div>
        </div>
        <div className={styles.keyMeta}>
          <span>
            OSRS account <strong>{apiKey.rsn}</strong>
          </span>
          <span className={styles.lastUsed}>
            Last used{' '}
            {apiKey.lastUsed ? apiKey.lastUsed.toLocaleDateString() : 'Never'}
          </span>
        </div>
      </div>

      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        width={400}
      >
        <div className={styles.deleteModal}>
          <h3>Delete API Key</h3>
          <p>
            Are you sure you want to delete the API key for{' '}
            <strong>{apiKey.rsn}</strong>? This action cannot be undone.
          </p>
          <div className={styles.modalActions}>
            <Button
              simple
              onClick={() => setShowDeleteModal(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleDelete()} loading={isDeleting}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
