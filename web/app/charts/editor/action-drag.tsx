'use client';

import { BCFAction } from '@blert/bcf';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { ActionIcon } from './action-icon';

import styles from './action-drag.module.scss';

const DRAG_THRESHOLD_PX = 4;

type Point = { x: number; y: number };

export type DragSource = { kind: 'palette' } | { kind: 'slot'; slot: number };

export type ActionDrag = { action: BCFAction; source: DragSource };

type DropTarget = { id: string; drop: (drag: ActionDrag) => void };

type ActionDragContextValue = {
  /** Captures ownership of the pointer for target `id`. */
  capture: (id: string, drop: (drag: ActionDrag) => void) => void;
  drag: ActionDrag | null;
  /**
   * Signals a press on `action`, which becomes a drag once the pointer moves.
   */
  press: (e: React.PointerEvent, action: BCFAction, source: DragSource) => void;
  /** Releases ownership of the pointer. */
  release: (id: string) => void;
};

const ActionDragContext = createContext<ActionDragContextValue | null>(null);

function moveFloat(float: HTMLElement, { x, y }: Point): void {
  float.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
}

/** Stops the click that follows the current pointer release. */
function swallowNextClick(): void {
  const stop = (e: MouseEvent) => e.stopPropagation();
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(
    () => window.removeEventListener('click', stop, { capture: true }),
    0,
  );
}

export function ActionDragProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [drag, setDrag] = useState<ActionDrag | null>(null);
  const [captured, setCaptured] = useState(false);
  const pointerRef = useRef<Point>({ x: 0, y: 0 });
  const floatRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<DropTarget | null>(null);

  const capture = useCallback(
    (id: string, drop: (drag: ActionDrag) => void) => {
      targetRef.current = { id, drop };
      setCaptured(true);
    },
    [],
  );

  const release = useCallback((id: string) => {
    if (targetRef.current?.id === id) {
      targetRef.current = null;
      setCaptured(false);
    }
  }, []);

  const press = useCallback(
    (e: React.PointerEvent, action: BCFAction, source: DragSource) => {
      if (e.button !== 0) {
        return;
      }

      const { pointerId, clientX: startX, clientY: startY } = e;
      const pressed: ActionDrag = { action, source };
      let dragging = false;
      let cancelled = false;

      function onMove(e: PointerEvent) {
        if (e.pointerId !== pointerId || cancelled) {
          return;
        }

        pointerRef.current = { x: e.clientX, y: e.clientY };
        if (!dragging) {
          const distance = Math.hypot(e.clientX - startX, e.clientY - startY);
          if (distance < DRAG_THRESHOLD_PX) {
            return;
          }
          dragging = true;
          document.documentElement.classList.add(styles.dragging);
          setDrag(pressed);
        }

        if (floatRef.current !== null) {
          moveFloat(floatRef.current, pointerRef.current);
        }
      }

      function onUp(e: PointerEvent) {
        if (e.pointerId !== pointerId) {
          return;
        }
        if (dragging) {
          if (!cancelled) {
            targetRef.current?.drop(pressed);
          }
          swallowNextClick();
        }
        end();
      }

      function onKeyDown(e: KeyboardEvent) {
        if (e.key !== 'Escape' || !dragging || cancelled) {
          return;
        }
        e.stopPropagation();
        cancelled = true;
        reset();
      }

      function end() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('keydown', onKeyDown, true);
        reset();
      }

      function reset() {
        document.documentElement.classList.remove(styles.dragging);
        targetRef.current = null;
        setCaptured(false);
        setDrag(null);
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', end);
      window.addEventListener('keydown', onKeyDown, true);
    },
    [],
  );

  const value = useMemo(
    () => ({ capture, drag, press, release }),
    [capture, drag, press, release],
  );

  return (
    <ActionDragContext.Provider value={value}>
      {children}
      {drag !== null &&
        !captured &&
        createPortal(
          <div
            className={styles.float}
            ref={(float) => {
              floatRef.current = float;
              if (float !== null) {
                moveFloat(float, pointerRef.current);
              }
            }}
          >
            <ActionIcon action={drag.action} size={32} />
          </div>,
          document.body,
        )}
    </ActionDragContext.Provider>
  );
}

export function useActionDrag(): ActionDragContextValue {
  const context = useContext(ActionDragContext);
  if (context === null) {
    throw new Error('useActionDrag must be used within an ActionDragProvider');
  }
  return context;
}
