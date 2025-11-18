'use client';

import Button from '@/components/button';
import Modal from '@/components/modal';

import styles from './style.module.scss';

export type ConfirmationModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger';
  loading?: boolean;
};

export function ConfirmationModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  loading = false,
}: ConfirmationModalProps) {
  const handleConfirm = () => {
    onConfirm();
  };

  return (
    <Modal className={styles.confirmationModal} open={open} onClose={onClose}>
      <div className={styles.modalHeader}>
        <h2>{title}</h2>
        <button onClick={onClose}>
          <i className="fas fa-times" />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className={styles.modalContent}>
        {typeof message === 'string' ? <p>{message}</p> : message}
      </div>
      <div className={styles.modalActions}>
        <Button onClick={onClose} simple disabled={loading}>
          {cancelText}
        </Button>
        <Button
          onClick={handleConfirm}
          className={variant === 'danger' ? styles.dangerButton : undefined}
          loading={loading}
        >
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}
