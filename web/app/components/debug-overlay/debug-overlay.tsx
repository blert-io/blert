'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { useClientOnly } from '@/hooks/client-only';

import styles from './style.module.scss';

type DebugOverlayProps = {
  children: ReactNode;
};

export function DebugOverlay({ children }: DebugOverlayProps) {
  const isClient = useClientOnly();
  if (process.env.NODE_ENV !== 'development' || !isClient) {
    return null;
  }
  const root = document.getElementById('portal-root');
  if (root === null) {
    return null;
  }
  return createPortal(<Overlay>{children}</Overlay>, root);
}

function Overlay({ children }: DebugOverlayProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== '`' ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      e.preventDefault();
      setOpen((open) => !open);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className={styles.overlay}>
      {open && <div className={styles.panel}>{children}</div>}
      <button
        aria-expanded={open}
        className={open ? `${styles.tab} ${styles.open}` : styles.tab}
        onClick={() => setOpen((open) => !open)}
        onMouseDown={(e) => e.preventDefault()}
        type="button"
      >
        <i className="fa-solid fa-bug" />
        <kbd className={styles.key}>`</kbd>
        <span className="sr-only">Debug</span>
      </button>
    </div>
  );
}

type DebugSectionProps = {
  children: ReactNode;
  title: string;
};

export function DebugSection({ children, title }: DebugSectionProps) {
  return (
    <section className={styles.section}>
      <h3 className={styles.title}>{title}</h3>
      <dl className={styles.rows}>{children}</dl>
    </section>
  );
}

type DebugRowProps = {
  label: string;
  value: boolean | number | string | null;
};

export function DebugRow({ label, value }: DebugRowProps) {
  const [shown, setShown] = useState(value);
  const [changes, setChanges] = useState(0);
  if (!Object.is(value, shown)) {
    setShown(value);
    setChanges(changes + 1);
  }

  let className = `${styles.value} ${styles[value === null ? 'null' : typeof value]}`;
  if (changes > 0) {
    className += ` ${styles.changed}`;
  }

  return (
    <>
      <dt className={styles.label}>{label}</dt>
      <dd className={className} key={changes}>
        {String(value)}
      </dd>
    </>
  );
}
