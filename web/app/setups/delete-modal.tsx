import { useCallback, useState } from 'react';

import { deleteSetup } from '@/actions/setup';
import Button from '@/components/button';
import Modal from '@/components/modal';
import { useToast } from '@/components/toast';

import styles from './delete-modal.module.scss';

export default function DeleteModal({
  open,
  onClose,
  onDelete,
  setupId,
}: {
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
  setupId: string;
}) {
  const [loading, setLoading] = useState(false);
  const showToast = useToast();

  const handleDelete = useCallback(async () => {
    setLoading(true);
    try {
      const success = await deleteSetup(setupId);
      if (success) {
        onDelete();
        showToast('Setup deleted successfully');
      } else {
        showToast('Failed to delete setup', 'error');
      }
    } catch (e) {
      showToast('Failed to delete setup', 'error');
    } finally {
      setLoading(false);
      onClose();
    }
  }, [onClose, onDelete, showToast, setupId]);

  return (
    <Modal open={open} onClose={onClose}>
      <div className={styles.deleteModal}>
        <h2>Delete Setup</h2>
        <p>
          Are you sure you want to delete this setup? This action cannot be
          undone.
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
            onClick={handleDelete}
          >
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}
