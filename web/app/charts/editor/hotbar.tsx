'use client';

import { BCFAction } from '@blert/bcf';
import Image from 'next/image';
import { useState } from 'react';

import {
  bcfToPlayerAttack,
  isSpecialAttack,
} from '@/components/attack-timeline';
import { useModifierKey } from '@/hooks/modifier-key';

import { useActionDrag } from './action-drag';
import { ActionIcon } from './action-icon';
import { actionName, cycleAttack } from './action-registry';
import { attackCooldown } from './attack-cycle';
import { DismissButton } from './dismiss-button';
import { HotbarSlots } from './editor-state';

import styles from './hotbar.module.scss';

type HotbarProps = {
  activeSlot: number | null;
  brush: BCFAction | null;
  disabled: boolean;
  onClearBrush: () => void;
  onSelectSlot: (slot: number) => void;
  onSetSlot: (slot: number, action: BCFAction | null) => void;
  onSwapSlots: (from: number, to: number) => void;
  slots: HotbarSlots;
};

export function Hotbar({
  activeSlot,
  brush,
  disabled,
  onClearBrush,
  onSelectSlot,
  onSetSlot,
  onSwapSlots,
  slots,
}: HotbarProps) {
  const shiftHeld = useModifierKey('Shift');
  const { drag } = useActionDrag();
  const [hovered, setHovered] = useState<number | null>(null);

  const from = drag?.source.kind === 'slot' ? drag.source.slot : null;
  const dropTarget = drag !== null && hovered !== from ? hovered : null;

  return (
    <>
      <div className={styles.slots}>
        {slots.map((action, i) => {
          let preview: SlotPreview | null = null;
          if (drag !== null && dropTarget === i) {
            preview = { kind: 'drop', action: drag.action };
          } else if (from === i && dropTarget !== null) {
            preview = { kind: 'drop', action: slots[dropTarget] };
          } else if (brush !== null && (action === null || shiftHeld)) {
            preview = { kind: 'bind', action: brush };
          } else if (action !== null && shiftHeld) {
            preview = { kind: 'clear' };
          }

          return (
            <Slot
              action={action}
              active={activeSlot === i}
              brush={brush}
              disabled={disabled}
              index={i}
              key={i}
              onHover={(over) => setHovered(over ? i : null)}
              onSelect={() => onSelectSlot(i)}
              onSet={(next) => onSetSlot(i, next)}
              onSwap={(source) => onSwapSlots(source, i)}
              preview={preview}
            />
          );
        })}
      </div>
      <div className={styles.brush}>
        <span className={styles.label}>Brush</span>
        {brush === null ? (
          <span className={styles.empty}>None</span>
        ) : (
          <BrushChip brush={brush} onClear={onClearBrush} />
        )}
      </div>
    </>
  );
}

type SlotPreview =
  | { kind: 'drop'; action: BCFAction | null }
  | { kind: 'bind'; action: BCFAction }
  | { kind: 'clear' };

type SlotProps = {
  action: BCFAction | null;
  active: boolean;
  brush: BCFAction | null;
  disabled: boolean;
  index: number;
  onHover: (hovered: boolean) => void;
  onSelect: () => void;
  onSet: (action: BCFAction | null) => void;
  onSwap: (from: number) => void;
  preview: SlotPreview | null;
};

function Slot({
  action,
  active,
  brush,
  disabled,
  index,
  onHover,
  onSelect,
  onSet,
  onSwap,
  preview,
}: SlotProps) {
  const { capture, drag, press, release } = useActionDrag();
  const id = `slot:${index}`;

  const captureDrag = () => {
    if (
      disabled ||
      drag === null ||
      (drag.source.kind === 'slot' && drag.source.slot === index)
    ) {
      return;
    }
    capture(id, ({ action, source }) => {
      if (source.kind === 'slot') {
        onSwap(source.slot);
      } else {
        onSet(action);
      }
    });
  };

  let className = styles.slot;
  if (active) {
    className += ` ${styles.active}`;
  }
  if (preview !== null) {
    className += ` ${styles[preview.kind]}`;
  }

  const content = (
    <>
      {action !== null && preview?.kind !== 'drop' && (
        <span className={styles.current}>
          <ActionIcon action={action} size={32} />
        </span>
      )}
      {preview !== null &&
        preview.kind !== 'clear' &&
        preview.action !== null && (
          <span className={styles.ghost}>
            <ActionIcon action={preview.action} size={32} />
          </span>
        )}
    </>
  );

  return (
    <button
      aria-label={`Slot ${index + 1}: ${action === null ? 'empty' : actionName(action)}`}
      aria-pressed={active}
      className={className}
      disabled={disabled}
      onClick={(e) => {
        if (e.shiftKey) {
          onSet(brush);
        } else {
          onSelect();
        }
      }}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (!disabled && action !== null) {
          press(e, action, { kind: 'slot', slot: index });
        }
      }}
      onPointerEnter={() => {
        onHover(true);
        captureDrag();
      }}
      onPointerLeave={() => {
        onHover(false);
        release(id);
      }}
      onPointerMove={captureDrag}
      type="button"
    >
      <span className={styles.slotKey}>{index + 1}</span>
      {content}
    </button>
  );
}

type BrushChipProps = {
  brush: BCFAction;
  onClear: () => void;
};

function BrushChip({ brush, onClear }: BrushChipProps) {
  const next = cycleAttack(brush, 1);
  return (
    <span className={styles.chip}>
      <ActionIcon action={brush} size={26} />
      <span className={styles.text}>
        <span className={styles.name}>{actionName(brush)}</span>
        {brush.type === 'attack' && (
          <span className={styles.meta}>
            {attackCooldown(brush.attackType)}t
            {next !== null && (
              <span
                className={
                  isSpecialAttack(bcfToPlayerAttack(brush.attackType))
                    ? `${styles.spec} ${styles.active}`
                    : styles.spec
                }
              >
                <Image
                  src="/images/combat/spec.png"
                  alt=""
                  width={12}
                  height={12}
                />
                <span className={styles.key}>S</span>
              </span>
            )}
          </span>
        )}
      </span>
      <DismissButton label="Clear brush" onClick={onClear} />
    </span>
  );
}
