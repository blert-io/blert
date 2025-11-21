import { useCallback, useState } from 'react';

import { deleteSetup } from '@/actions/setup';
import Button from '@/components/button';
import Modal from '@/components/modal';
import { useToast } from '@/components/toast';

import { setupLocalStorage } from './local-storage';

import styles from './delete-modal.module.scss';

export default function DeleteModal({
  open,
  onClose,
  onDelete,
  setupId,
  title,
  isLocal = false,
}: {
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
  setupId: string;
  title?: string;
  isLocal?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  const handleDelete = useCallback(async () => {
    setLoading(true);
    try {
      let success;
      if (isLocal) {
        setupLocalStorage.deleteSetup(setupId);
        success = true;
      } else {
        success = await deleteSetup(setupId);
      }
      if (success) {
        onDelete();
        showToast('Setup deleted successfully', 'success');
      } else {
        showToast(`Failed to delete ${title ?? 'setup'}`, 'error');
      }
    } catch {
      showToast(`Failed to delete ${title ?? 'setup'}`, 'error');
    } finally {
      setLoading(false);
      onClose();
    }
  }, [onClose, onDelete, showToast, setupId, isLocal, title]);

  return (
    <Modal open={open} onClose={onClose}>
      <div className={styles.deleteModal}>
        <h2>Delete Setup</h2>
        <p>
          Are you sure you want to delete {title ? `"${title}"` : 'this setup'}?
          This action cannot be undone.
        </p>
        <div className={styles.actions}>
          <Button
            className={styles.cancel}
            disabled={loading}
            onClick={onClose}
            simple
          >
            Cancel
          </Button>
          <Button
            className={styles.delete}
            disabled={loading}
            loading={loading}
            onClick={() => void handleDelete()}
          >
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}
