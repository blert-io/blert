import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const STORAGE_PREFIX = 'blert:restorable-state:';
const HISTORY_KEY_FIELD = 'blertRestorableKey';
const SCROLL_DEBOUNCE_MS = 150;

/**
 * Returns a stable UUID associated with the current history entry. On first
 * client render the value is null; after mount it resolves to either an
 * existing key already stashed on `window.history.state` or a freshly
 * generated one merged in via `replaceState`. The key survives back/forward
 * navigation because `history.state` travels with the entry.
 */
function useHistoryEntryKey(): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    const current = window.history.state as Record<string, unknown> | null;
    const existing = current?.[HISTORY_KEY_FIELD];
    if (typeof existing === 'string') {
      setKey(existing);
      return;
    }
    const newKey = crypto.randomUUID();
    window.history.replaceState(
      { ...(current ?? {}), [HISTORY_KEY_FIELD]: newKey },
      '',
    );
    setKey(newKey);
  }, []);
  return key;
}

type HistoryStateOptions<T> = {
  /** Namespace for the stored state. */
  scope: string;
  /** The state value to persist. */
  state: T;
  /** Validates the restored state. */
  validate: (raw: unknown) => T | null;
  /** Callback invoked when state is restored and validated. */
  onRestore: (state: T) => void;
};

/**
 * Persists a `T` to `sessionStorage` keyed by the current history entry. Each
 * history entry owns its own isolated snapshot, so forward/back navigation
 * restores per-entry state instead of sharing one value by URL.
 *
 * This should be used instead of raw history APIs because Next.js internally
 * owns and clobbers those, providing no guarantees about state persistence.
 *
 * The `T` must be JSON-serializable.
 * `onRestore` fires once on mount if a valid saved snapshot exists.
 */
export function useHistoryState<T>({
  scope,
  state,
  validate,
  onRestore,
}: HistoryStateOptions<T>): void {
  const historyEntryKey = useHistoryEntryKey();
  const storageKey =
    historyEntryKey !== null
      ? `${STORAGE_PREFIX}${scope}:${historyEntryKey}`
      : null;

  const restoredRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const validateRef = useRef(validate);
  validateRef.current = validate;
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  useEffect(() => {
    if (restoredRef.current || storageKey === null) {
      return;
    }
    restoredRef.current = true;
    const raw = window.sessionStorage.getItem(storageKey);
    if (raw === null) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const validated = validateRef.current(parsed);
    if (validated !== null) {
      onRestoreRef.current(validated);
    }
  }, [storageKey]);

  const serializedState = JSON.stringify(state);
  useEffect(() => {
    if (!restoredRef.current || storageKey === null) {
      return;
    }
    window.sessionStorage.setItem(storageKey, JSON.stringify(stateRef.current));
  }, [storageKey, serializedState]);
}

type RestorableScrollStateOptions<T> = HistoryStateOptions<T>;

/**
 * Extended variant of `useHistoryState` that also preserves the scroll offset
 * of a scroll container. Attach the returned `scrollRef` to the element whose
 * scroll position should be preserved (typically an `overflow: auto`
 * container).
 */
export function useRestorableScrollState<
  T,
  El extends HTMLElement = HTMLElement,
>({
  scope,
  state,
  onRestore,
  validate,
}: RestorableScrollStateOptions<T>): {
  scrollRef: (el: El | null) => void;
} {
  type Payload = { state: T; scrollTop: number };

  const historyEntryKey = useHistoryEntryKey();
  const [scrollEl, setScrollEl] = useState<El | null>(null);
  const restoredRef = useRef(false);
  const pendingScrollTopRef = useRef<number | null>(null);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const validateRef = useRef(validate);
  validateRef.current = validate;
  const stateRef = useRef(state);
  stateRef.current = state;

  const scrollRef = useCallback((el: El | null) => setScrollEl(el), []);

  const storageKey =
    historyEntryKey !== null
      ? `${STORAGE_PREFIX}${scope}:${historyEntryKey}`
      : null;

  // Restore once, after both the history key and the scroll element are
  // available.
  //
  // State restore and `scrollTop` must land together so the DOM matches the
  // saved scroll offset. We `flushSync` the state updates outside of React's
  // render phase (via `setTimeout`) then apply `scrollTop` on the restored DOM.
  // `flushSync` synchronously reruns the save-on-change effect before
  // `scrollTop` has been applied, so publish the intended offset via a ref for
  // that effect to read.
  useEffect(() => {
    if (restoredRef.current || storageKey === null || scrollEl === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (restoredRef.current) {
        return;
      }
      restoredRef.current = true;
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw === null) {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      if (parsed === null || typeof parsed !== 'object') {
        return;
      }
      const payload = parsed as Partial<Payload>;
      if (
        typeof payload.scrollTop !== 'number' ||
        !Number.isFinite(payload.scrollTop)
      ) {
        return;
      }
      const validated = validateRef.current(payload.state);
      if (validated === null) {
        return;
      }
      pendingScrollTopRef.current = payload.scrollTop;
      flushSync(() => {
        onRestoreRef.current(validated);
      });
      scrollEl.scrollTop = payload.scrollTop;
      pendingScrollTopRef.current = null;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey, scrollEl]);

  // Persist on state changes once restore has been attempted.
  const serializedState = JSON.stringify(state);
  useEffect(() => {
    if (!restoredRef.current || storageKey === null) {
      return;
    }
    const scrollTop =
      pendingScrollTopRef.current ??
      (scrollEl !== null ? scrollEl.scrollTop : 0);
    const payload: Payload = { state: stateRef.current, scrollTop };
    window.sessionStorage.setItem(storageKey, JSON.stringify(payload));
  }, [storageKey, serializedState, scrollEl]);

  // Persist state on scroll with the latest scroll offset.
  useEffect(() => {
    if (storageKey === null || scrollEl === null) {
      return;
    }
    let timeout: number | null = null;
    const save = () => {
      const payload: Payload = {
        state: stateRef.current,
        scrollTop: scrollEl.scrollTop,
      };
      window.sessionStorage.setItem(storageKey, JSON.stringify(payload));
    };
    const onScroll = () => {
      if (!restoredRef.current) {
        return;
      }
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
      timeout = window.setTimeout(() => {
        timeout = null;
        save();
      }, SCROLL_DEBOUNCE_MS);
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollEl.removeEventListener('scroll', onScroll);
      if (timeout !== null) {
        window.clearTimeout(timeout);
        if (restoredRef.current) {
          save();
        }
      }
    };
  }, [storageKey, scrollEl]);

  return { scrollRef };
}
