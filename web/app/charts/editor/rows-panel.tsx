'use client';

import { BCFActor, BlertChartFormat } from '@blert/bcf';
import { useMemo, useRef, useState } from 'react';

import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { clamp } from '@/utils/math';

import { DRAG_THRESHOLD_PX, placeOf, swallowNextClick } from './action-drag';

import styles from './rows-panel.module.scss';

type Box = { top: number; bottom: number };

/**
 * Represents a row dragged `dy` pixels from where it was pressed,
 * held over row `target`.
 */
type RowDrag = { boxes: Box[]; dy: number; source: number; target: number };

type RowsPanelProps = {
  bcf: BlertChartFormat;
  focusedActorId: string | null;
  onAddPlayer: () => void;
  onDuplicateActor: (actor: BCFActor) => void;
  onFocusActor: (actorId: string) => void;
  onRemoveActor: (actorId: string) => void;
  onRenameActor: (actorId: string, name: string) => void;
  onRenamingChange: (actorId: string | null) => void;
  onReorderRows: (rowOrder: string[]) => void;
  renamingActorId: string | null;
};

export function RowsPanel({
  bcf,
  focusedActorId,
  onAddPlayer,
  onDuplicateActor,
  onFocusActor,
  onRemoveActor,
  onRenameActor,
  onRenamingChange,
  onReorderRows,
  renamingActorId,
}: RowsPanelProps) {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const [committed, setCommitted] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const actionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tick of bcf.timeline.ticks) {
      for (const cell of tick.cells) {
        const count = counts.get(cell.actorId) ?? 0;
        counts.set(cell.actorId, count + (cell.actions?.length ?? 0));
      }
    }
    return counts;
  }, [bcf]);

  const rows = (bcf.config.rowOrder ?? []).flatMap((actorId) => {
    const actor = bcf.timeline.actors.find((a) => a.id === actorId);
    return actor === undefined ? [] : [actor];
  });
  const removable = bcf.timeline.actors.length > 1;

  const press = (e: React.PointerEvent, source: number) => {
    if (e.button !== 0) {
      return;
    }

    const { pointerId, clientY: startY } = e;
    const order = rows.map((actor) => actor.id);
    const boxes = order.map((actorId) => {
      const row = rowRefs.current.get(actorId)!;
      return { top: row.offsetTop, bottom: row.offsetTop + row.offsetHeight };
    });
    let dragging = false;
    let cancelled = false;
    let target = source;

    function onMove(e: PointerEvent) {
      if (e.pointerId !== pointerId || cancelled) {
        return;
      }

      if (!dragging) {
        if (Math.abs(e.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        dragging = true;
        setCommitted(false);
      }

      const dy = clamp(
        e.clientY - startY,
        boxes[0].top - boxes[source].top,
        boxes[boxes.length - 1].top - boxes[source].top,
      );
      const center = (boxes[source].top + boxes[source].bottom) / 2 + dy;
      const place = boxes.findIndex((box) => center < box.bottom);
      target = place === -1 ? boxes.length - 1 : place;
      setDrag({ boxes, dy, source, target });
    }

    function onUp(e: PointerEvent) {
      if (e.pointerId !== pointerId) {
        return;
      }
      if (dragging) {
        swallowNextClick();
        if (!cancelled && target !== source) {
          const reordered = order.filter((_, i) => i !== source);
          reordered.splice(target, 0, order[source]);
          setCommitted(true);
          onReorderRows(reordered);
        }
      }
      end();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || !dragging || cancelled) {
        return;
      }
      e.stopPropagation();
      cancelled = true;
      setDrag(null);
    }

    function end() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', onKeyDown, true);
      setDrag(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', onKeyDown, true);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.content}>
        <ul
          className={
            committed ? `${styles.rows} ${styles.committed}` : styles.rows
          }
        >
          {rows.map((actor, index) => {
            const count = actionCounts.get(actor.id) ?? 0;
            let className = styles.row;
            if (actor.id === focusedActorId) {
              className += ` ${styles.focused}`;
            }

            let style: React.CSSProperties | undefined;
            if (drag !== null) {
              const { boxes, dy, source, target } = drag;
              const y =
                index === source
                  ? dy
                  : boxes[placeOf(index, source, target)].top -
                    boxes[index].top;
              style = { transform: `translateY(${y}px)` };
              if (index === source) {
                className += ` ${styles.held}`;
              }
            }

            const swatch = (
              <span
                className={
                  actor.type === 'npc'
                    ? `${styles.swatch} ${styles.npc}`
                    : styles.swatch
                }
              />
            );

            return (
              <li
                className={className}
                key={actor.id}
                ref={(row) => {
                  if (row !== null) {
                    rowRefs.current.set(actor.id, row);
                  }
                }}
                style={style}
              >
                {actor.id === renamingActorId ? (
                  <div className={styles.editing}>
                    {swatch}
                    <NameInput
                      name={actor.name}
                      onCancel={() => onRenamingChange(null)}
                      onCommit={(name) => onRenameActor(actor.id, name)}
                    />
                  </div>
                ) : (
                  <>
                    <button
                      className={styles.select}
                      onClick={() => onFocusActor(actor.id)}
                      onDoubleClick={() => onRenamingChange(actor.id)}
                      onMouseDown={(e) => e.preventDefault()}
                      onPointerDown={(e) => press(e, index)}
                      type="button"
                    >
                      <i
                        className={`fa-solid fa-grip-vertical ${styles.grip}`}
                      />
                      {swatch}
                      <span className={styles.name}>{actor.name}</span>
                      <span className={styles.meta}>
                        {count} {count === 1 ? 'action' : 'actions'}
                      </span>
                    </button>
                    <div className={styles.actions}>
                      <IconButton
                        icon="fa-pen"
                        label="Rename"
                        onClick={() => onRenamingChange(actor.id)}
                        tooltip="Rename (F2)"
                      />
                      <IconButton
                        icon="fa-clone"
                        label="Duplicate row"
                        onClick={() => onDuplicateActor(actor)}
                        tooltip="Duplicate row"
                      />
                      <IconButton
                        className={styles.remove}
                        disabled={!removable}
                        icon="fa-trash-can"
                        label="Remove row"
                        onClick={() => onRemoveActor(actor.id)}
                        tooltip="Remove row"
                      />
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <button
          className={styles.add}
          onClick={onAddPlayer}
          onMouseDown={(e) => e.preventDefault()}
          type="button"
        >
          <span className={styles.skeleton}>
            <span className={styles.skeletonSwatch} />
            <span className={styles.skeletonName} />
            <span className={styles.skeletonMeta} />
          </span>
          <span className={styles.addLabel}>
            <i className="fa-solid fa-plus" />
            Add player
          </span>
        </button>
      </div>
      <p className={styles.hint}>
        Drag to reorder · Double-click a name to rename
      </p>
    </div>
  );
}

type IconButtonProps = {
  className?: string;
  disabled?: boolean;
  icon: string;
  label: string;
  onClick: () => void;
  tooltip: string;
};

function IconButton({
  className,
  disabled,
  icon,
  label,
  onClick,
  tooltip,
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={
        className === undefined
          ? styles.iconButton
          : `${styles.iconButton} ${className}`
      }
      data-tooltip-content={tooltip}
      data-tooltip-id={GLOBAL_TOOLTIP_ID}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      type="button"
    >
      <i className={`fa-solid ${icon}`} />
    </button>
  );
}

type NameInputProps = {
  name: string;
  onCancel: () => void;
  onCommit: (name: string) => void;
};

function NameInput({ name, onCancel, onCommit }: NameInputProps) {
  const [text, setText] = useState(name);
  const cancelled = useRef(false);

  return (
    <input
      aria-label="Row name"
      autoFocus
      className={styles.nameInput}
      onBlur={() => {
        const trimmed = text.trim();
        if (cancelled.current || trimmed === '' || trimmed === name) {
          onCancel();
        } else {
          onCommit(trimmed);
        }
      }}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        } else if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      type="text"
      value={text}
    />
  );
}
