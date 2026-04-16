'use client';

import { useContext } from 'react';

import Modal from '@/components/modal';
import { DisplayContext } from '@/display';

import { useFilterPanel } from './filter-panel-context';

import styles from './filter-panel.module.scss';

type FilterPanelProps = {
  children: React.ReactNode;
  onReset?: () => void;
  canReset?: boolean;
};

export default function FilterPanel({
  children,
  onReset,
  canReset = true,
}: FilterPanelProps) {
  const display = useContext(DisplayContext);
  const { open, setOpen } = useFilterPanel();

  const resetButton = onReset !== undefined && (
    <button
      className={styles.reset}
      disabled={!canReset}
      onClick={onReset}
      type="button"
    >
      Reset
    </button>
  );

  const isCompact = display.isCompact();
  const header = (
    <div className={styles.header}>
      <h3>Filters</h3>
      <div className={styles.headerActions}>
        {resetButton}
        {isCompact && (
          <button
            className={styles.close}
            onClick={() => setOpen(false)}
            type="button"
            aria-label="Close filters"
          >
            <i className="fas fa-times" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );

  if (isCompact) {
    return (
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        className={styles.modal}
      >
        {header}
        <div className={styles.modalContent}>{children}</div>
      </Modal>
    );
  }

  return (
    <aside className={`${styles.panel} ${open ? '' : styles.closed}`}>
      <div className={styles.panelInner}>
        {header}
        <div className={styles.content}>{children}</div>
      </div>
    </aside>
  );
}
