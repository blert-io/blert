'use client';

import { createContext, useCallback, useContext, useState } from 'react';

import styles from './style.module.scss';

type ToastType = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

type ShowToast = (message: string, type?: ToastType) => void;

export const ToastContext = createContext<ShowToast>(() => {});

const TOAST_DURATION_MS = 4000;

const TOAST_ICONS: Record<ToastType, string> = {
  info: 'fas fa-info-circle',
  success: 'fas fa-check-circle',
  error: 'fas fa-exclamation-circle',
};

export default function ToastProvider({
  children,
}: {
  children?: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [nextId, setNextId] = useState(1);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = nextId;
      setNextId((prev) => prev + 1);
      setToasts((prev) => [...prev, { id, message, type }]);

      setTimeout(() => {
        removeToast(id);
      }, TOAST_DURATION_MS);
    },
    [nextId, removeToast],
  );

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div
        className={styles.container}
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${styles[toast.type]}`}
            role="alert"
            aria-live="polite"
          >
            <i
              className={`${TOAST_ICONS[toast.type]} ${styles.toastIcon}`}
              aria-hidden="true"
            />
            <span className={styles.toastMessage}>{toast.message}</span>
            <button
              className={styles.close}
              onClick={() => removeToast(toast.id)}
              aria-label={`Close ${toast.type} notification`}
              type="button"
            >
              <i className="fas fa-times" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Hook to show a toast message.
 * @returns A function that shows a toast message.
 */
export function useToast(): ShowToast {
  const toast = useContext(ToastContext);
  if (toast === null) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return toast;
}
