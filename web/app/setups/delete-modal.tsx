import { useCallback, useState } from 'react';

import { deleteSetup } from '@/actions/setup';
import ConfirmationModal from '@/components/confirmation-modal';
import { useToast } from '@/components/toast';

import { setupLocalStorage } from './local-storage';

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
    <ConfirmationModal
      open={open}
      onClose={onClose}
      onConfirm={() => void handleDelete()}
      title="Delete Setup"
      message={`Are you sure you want to delete ${title ? `"${title}"` : 'this setup'}? This action cannot be undone.`}
      confirmText="Delete"
      variant="danger"
      loading={loading}
    />
  );
}
