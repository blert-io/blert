'use client';

import Link from 'next/link';
import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import styles from './style.module.scss';
import { Heading } from './heading';

type AppendixItem = {
  id: string;
  title: string;
  content: React.ReactNode;
  anchor: HTMLElement | null;
};

type AppendixContextValue = {
  register: (
    id: string,
    title: string,
    content: React.ReactNode,
    anchor: HTMLElement | null,
  ) => void;
  unregister: (id: string) => void;
  items: AppendixItem[];
};

const AppendixContext = createContext<AppendixContextValue | null>(null);

export function AppendixProvider({ children }: { children: React.ReactNode }) {
  const [itemsMap, setItemsMap] = useState<Map<string, AppendixItem>>(
    () => new Map(),
  );

  const register = useCallback(
    (
      id: string,
      title: string,
      content: React.ReactNode,
      anchor: HTMLElement | null,
    ) => {
      setItemsMap((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(id);
        updated.set(id, {
          id,
          title,
          content,
          anchor: anchor ?? existing?.anchor ?? null,
        });
        return updated;
      });
    },
    [],
  );

  const unregister = useCallback((id: string) => {
    setItemsMap((prev) => {
      if (!prev.has(id)) {
        return prev;
      }
      const updated = new Map(prev);
      updated.delete(id);
      return updated;
    });
  }, []);

  const items = useMemo(() => {
    const arr = Array.from(itemsMap.values());
    const byDomOrder = (a: AppendixItem, b: AppendixItem) => {
      if (a.anchor && b.anchor) {
        const relation = a.anchor.compareDocumentPosition(b.anchor);
        if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
          return -1;
        }
        if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
          return 1;
        }
      }
      // Fallback deterministic order
      return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    };
    return arr.sort(byDomOrder);
  }, [itemsMap]);

  const value = useMemo<AppendixContextValue>(() => {
    return { register, unregister, items };
  }, [register, unregister, items]);

  return (
    <AppendixContext.Provider value={value}>
      {children}
    </AppendixContext.Provider>
  );
}

function useAppendixContext(): AppendixContextValue {
  const ctx = useContext(AppendixContext);
  if (!ctx) {
    throw new Error(
      'Appendix components must be used within <AppendixProvider>',
    );
  }
  return ctx;
}

function indexToLetter(index: number): string {
  // Supports A, B, ..., Z, AA, AB, ... if many entries
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let n = index;
  let result = '';
  do {
    result = letters[n % 26] + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

export function Define({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  const { register, unregister } = useAppendixContext();
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    register(id, title, children, anchorRef.current);
    return () => unregister(id);
  }, [id, title, children, register, unregister]);

  // Invisible anchor to capture DOM order.
  return (
    <span
      ref={anchorRef}
      data-appendix-id={id}
      className={styles.appendixAnchor}
    />
  );
}

export function Ref({
  id,
  variant = 'inline',
  text,
}: {
  id: string;
  variant?: 'inline' | 'sup';
  text?: string;
}) {
  const { items } = useAppendixContext();
  const index = items.findIndex((it) => it.id === id);
  const item = index >= 0 ? items[index] : undefined;
  const letter = index >= 0 ? indexToLetter(index) : '?';
  const title = item?.title ?? '';
  const href = `#appendix-${id}`;

  if (variant === 'sup') {
    return (
      <Link
        href={href}
        className={styles.appendixRef}
        title={
          title ? `See Appendix ${letter}: ${title}` : `See Appendix ${letter}`
        }
      >
        <sup>[{letter}]</sup>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={styles.appendixRef}
      title={
        title ? `See Appendix ${letter}: ${title}` : `See Appendix ${letter}`
      }
    >
      {text ?? `Appendix ${letter}`}
    </Link>
  );
}

export function List() {
  const { items } = useAppendixContext();

  if (items.length === 0) {
    return null;
  }

  return (
    <section className={styles.appendix} id="appendix">
      <Heading level={2} text="Appendix" id="appendix" />
      {items.map((item, idx) => {
        const letter = indexToLetter(idx);
        const headingText = `${letter}. ${item.title}`;
        const itemId = `appendix-${item.id}`;
        return (
          <div key={item.id} className={styles.appendixItem} id={itemId}>
            <Heading level={3} text={headingText} id={itemId} />
            <div className={styles.appendixContent}>{item.content}</div>
          </div>
        );
      })}
    </section>
  );
}

export const Appendix = {
  Define,
  Ref,
  List,
};
