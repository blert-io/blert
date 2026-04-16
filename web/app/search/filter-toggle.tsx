'use client';

import { useFilterPanel } from './filter-panel-context';

import styles from './filter-toggle.module.scss';

export default function FilterToggle() {
  const { open, toggle, activeCount } = useFilterPanel();

  return (
    <button
      className={`${styles.toggle} ${open ? styles.active : ''}`}
      onClick={toggle}
      aria-pressed={open}
      aria-label={
        open
          ? `Hide filters${activeCount > 0 ? ` (${activeCount} active)` : ''}`
          : `Show filters${activeCount > 0 ? ` (${activeCount} active)` : ''}`
      }
      type="button"
    >
      <i className="fas fa-filter" aria-hidden />
      <span>Filters</span>
      {activeCount > 0 && (
        <span className={styles.badge} aria-hidden>
          {activeCount}
        </span>
      )}
    </button>
  );
}
