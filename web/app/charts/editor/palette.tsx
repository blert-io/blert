'use client';

import { BCFAction } from '@blert/bcf';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import Button from '@/components/button';
import Input from '@/components/input';
import { useSetting } from '@/utils/user-settings';

import { useActionDrag } from './action-drag';
import { ActionIcon } from './action-icon';
import {
  ACTION_ENTRIES,
  ActionEntry,
  ActionTab,
  actionKey,
  filterEntries,
} from './action-registry';
import { specCost } from './attack-cycle';
import { DismissButton } from './dismiss-button';

import styles from './palette.module.scss';

const TABS: { tab: ActionTab; label: string }[] = [
  { tab: 'attack', label: 'Attacks' },
  { tab: 'spell', label: 'Spells' },
  { tab: 'utility', label: 'Utility' },
  { tab: 'npcAttack', label: 'NPC' },
];

const SLIDE_MS = 150;
const RIPPLE_STEP_MS = 25;
const RIPPLE_SPAN_MS = 200;

type PaletteOrder = Partial<Record<ActionTab, string[]>>;

type Box = { left: number; top: number; right: number; bottom: number };

type Reorder = {
  target: number;
  previous: number;
  boxes: Box[];
};

function orderEntriesByKey(
  entries: ActionEntry[],
  keys: string[] | undefined,
): ActionEntry[] {
  if (keys === undefined) {
    return entries;
  }
  const rank = new Map(keys.map((key, i) => [key, i]));
  const rankOf = (entry: ActionEntry) => rank.get(entry.key) ?? keys.length;
  return [...entries].sort((a, b) => rankOf(a) - rankOf(b));
}

/**
 * Returns the place taken by the tile at `index` while the tile at `source`
 * is held over `target`.
 */
function placeOf(index: number, source: number, target: number): number {
  if (index === source) {
    return target;
  }
  if (source < index && index <= target) {
    return index - 1;
  }
  if (target <= index && index < source) {
    return index + 1;
  }
  return index;
}

function boxOf(tile: HTMLElement): Box {
  return {
    left: tile.offsetLeft,
    top: tile.offsetTop,
    right: tile.offsetLeft + tile.offsetWidth,
    bottom: tile.offsetTop + tile.offsetHeight,
  };
}

type PaletteProps = {
  brush: BCFAction | null;
  onAddToHotbar: (action: BCFAction) => void;
  onClose: () => void;
  onSelect: (action: BCFAction | null) => void;
  searchRef: React.Ref<HTMLInputElement>;
};

export function Palette({
  brush,
  onAddToHotbar,
  onClose,
  onSelect,
  searchRef,
}: PaletteProps) {
  const [tab, setTab] = useState<ActionTab>('attack');
  const [query, setQuery] = useState('');
  const [order, setOrder] = useSetting<PaletteOrder>({
    key: 'chart-editor.palette-order',
    defaultValue: {},
  });
  const [reorder, setReorder] = useState<Reorder | null>(null);
  const [committed, setCommitted] = useState(false);
  const { capture, drag, release } = useActionDrag();
  const dragged = drag?.source.kind === 'palette' ? drag.action : null;

  const gridRef = useRef<HTMLDivElement | null>(null);
  const tilesRef = useRef(new Map<string, HTMLElement>());
  const firstRef = useRef<Map<string, DOMRect> | null>(null);
  const slidesRef = useRef(new Map<string, Animation>());

  const searching = query.trim() !== '';
  const entries = useMemo(() => {
    const ordered = TABS.flatMap((t) =>
      orderEntriesByKey(
        ACTION_ENTRIES.filter((e) => e.tab === t.tab),
        order[t.tab],
      ),
    );
    return searching
      ? filterEntries(ordered, query)
      : ordered.filter((e) => e.tab === tab);
  }, [order, query, searching, tab]);

  const brushKey = brush === null ? null : actionKey(brush);
  const draggedKey = dragged === null ? null : actionKey(dragged);
  const source = entries.findIndex((e) => e.key === draggedKey);

  const defaultKeys = ACTION_ENTRIES.filter((e) => e.tab === tab).map(
    (e) => e.key,
  );
  const customized =
    !searching && entries.some((e, i) => e.key !== defaultKeys[i]);

  const recordPositions = () => {
    const first = new Map<string, DOMRect>();
    for (const entry of entries) {
      const tile = tilesRef.current.get(entry.key);
      if (tile !== undefined) {
        first.set(entry.key, tile.getBoundingClientRect());
      }
    }
    firstRef.current = first;
  };

  useLayoutEffect(() => {
    const first = firstRef.current;
    if (first === null) {
      return;
    }
    firstRef.current = null;

    for (const entry of entries) {
      const before = first.get(entry.key);
      const tile = tilesRef.current.get(entry.key);
      if (before === undefined || tile === undefined) {
        continue;
      }

      slidesRef.current.get(entry.key)?.cancel();
      const after = tile.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (dx === 0 && dy === 0) {
        continue;
      }

      const slide = tile.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: SLIDE_MS, easing: 'ease' },
      );
      slidesRef.current.set(entry.key, slide);
    }
  }, [entries]);

  useEffect(() => {
    const grid = gridRef.current;
    if (dragged === null || searching || source === -1 || grid === null) {
      return;
    }

    const keys = entries.map((entry) => entry.key);
    const boxes = keys.map((key) => boxOf(tilesRef.current.get(key)!));
    let target = source;

    const commit = (place: number) => {
      const reordered = keys.filter((key) => key !== keys[source]);
      reordered.splice(place, 0, keys[source]);
      setOrder({ ...order, [tab]: reordered });
      setCommitted(true);
    };

    const onMove = (e: PointerEvent) => {
      const rect = grid.getBoundingClientRect();
      let next = source;

      if (
        e.clientX >= rect.left &&
        e.clientX < rect.right &&
        e.clientY >= rect.top &&
        e.clientY < rect.bottom
      ) {
        const x = e.clientX - rect.left - grid.clientLeft + grid.scrollLeft;
        const y = e.clientY - rect.top - grid.clientTop + grid.scrollTop;
        const place = boxes.findIndex(
          (box) =>
            x >= box.left && x < box.right && y >= box.top && y < box.bottom,
        );
        next = place === -1 ? target : place;
        const drop = next;
        capture('palette', () => {
          if (drop !== source) {
            commit(drop);
          }
        });
      } else {
        release('palette');
      }

      if (next !== target) {
        setReorder({ target: next, previous: target, boxes });
        target = next;
      }
    };

    setCommitted(false);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      release('palette');
      setReorder(null);
    };
  }, [
    capture,
    dragged,
    entries,
    order,
    release,
    searching,
    setOrder,
    source,
    tab,
  ]);

  return (
    <div className={styles.palette}>
      <div className={styles.header}>
        <span className={styles.title}>Actions</span>
        <DismissButton label="Close" onClick={onClose} />
      </div>
      <div className={styles.search}>
        <Input
          faIcon="fa-solid fa-magnifying-glass"
          fluid
          id="palette-search"
          label="Search actions"
          onChange={(e) => {
            recordPositions();
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.currentTarget.blur();
            } else if (e.key === 'Enter' && entries.length > 0) {
              onSelect(entries[0].action);
            }
          }}
          ref={searchRef}
          value={query}
        />
      </div>
      <div className={styles.tabs}>
        <div className={styles.tabList} role="tablist">
          {TABS.map((t) => (
            <button
              aria-selected={!searching && t.tab === tab}
              className={styles.tab}
              key={t.tab}
              onClick={() => {
                setQuery('');
                setTab(t.tab);
              }}
              onMouseDown={(e) => e.preventDefault()}
              role="tab"
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
        {customized && (
          <Button
            className={styles.reset}
            onClick={() => {
              recordPositions();
              const { [tab]: _, ...rest } = order;
              setOrder(rest);
            }}
            toolbar
          >
            Reset order
          </Button>
        )}
      </div>
      <div
        className={
          committed ? `${styles.entries} ${styles.committed}` : styles.entries
        }
        ref={gridRef}
        style={{ '--slide-duration': `${SLIDE_MS}ms` } as React.CSSProperties}
      >
        {entries.length === 0 && (
          <span className={styles.empty}>No actions match</span>
        )}
        {entries.map((entry, index) => {
          let offset = null;
          let delay = 0;
          if (dragged !== null && reorder !== null) {
            const { boxes, previous, target } = reorder;
            const place = placeOf(index, source, target);
            offset = {
              x: boxes[place].left - boxes[index].left,
              y: boxes[place].top - boxes[index].top,
            };
            const span = Math.max(1, Math.abs(target - previous));
            const step = Math.min(RIPPLE_STEP_MS, RIPPLE_SPAN_MS / span);
            delay = Math.abs(place - target) * step;
          }

          return (
            <Tile
              brushKey={brushKey}
              delay={delay}
              entry={entry}
              held={dragged !== null && index === source}
              key={entry.key}
              offset={offset}
              onAddToHotbar={onAddToHotbar}
              onSelect={onSelect}
              ref={(tile) => {
                if (tile !== null) {
                  tilesRef.current.set(entry.key, tile);
                }
              }}
            />
          );
        })}
      </div>
      <p className={styles.hint}>
        Shift-click to add to hotbar · Drag to place or reorder
      </p>
    </div>
  );
}

type TileProps = {
  brushKey: string | null;
  delay: number;
  entry: ActionEntry;
  held: boolean;
  offset: { x: number; y: number } | null;
  onAddToHotbar: (action: BCFAction) => void;
  onSelect: (action: BCFAction | null) => void;
  ref: React.Ref<HTMLButtonElement>;
};

function Tile({
  brushKey,
  delay,
  entry,
  held,
  offset,
  onAddToHotbar,
  onSelect,
  ref,
}: TileProps) {
  const { press } = useActionDrag();
  const active = brushKey === entry.key;
  const attackType =
    entry.action.type === 'attack' ? entry.action.attackType : null;
  const cost = attackType !== null ? specCost(attackType) : undefined;

  let className = styles.tile;
  if (active) {
    className += ` ${styles.active}`;
  }
  if (held) {
    className += ` ${styles.held}`;
  }

  return (
    <button
      aria-pressed={active}
      className={className}
      onClick={(e) => {
        if (e.shiftKey) {
          onAddToHotbar(entry.action);
        } else {
          onSelect(active ? null : entry.action);
        }
      }}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => press(e, entry.action, { kind: 'palette' })}
      ref={ref}
      style={
        {
          '--slide-delay': `${delay}ms`,
          transform:
            offset === null
              ? undefined
              : `translate(${offset.x}px, ${offset.y}px)`,
        } as React.CSSProperties
      }
      type="button"
    >
      <i className={`fa-solid fa-grip-vertical ${styles.grip}`} />
      <ActionIcon action={entry.action} size={32} />
      <span className={styles.name}>{entry.name}</span>
      {attackType !== null && (
        <span className={styles.meta}>{entry.cooldown}t</span>
      )}
      {cost !== undefined && <span className={styles.cost}>{cost}%</span>}
    </button>
  );
}
