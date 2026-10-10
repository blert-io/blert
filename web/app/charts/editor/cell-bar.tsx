'use client';

import { BCFAction, BCFResolver } from '@blert/bcf';

import { ActionIcon } from './action-icon';
import { actionName } from './action-registry';
import { attackCooldown, CooldownConflict } from './attack-cycle';
import { DismissButton } from './dismiss-button';
import { CellCoord } from './editor-state';

import styles from './cell-bar.module.scss';

type CellBarProps = {
  conflicts: CooldownConflict[];
  focus: CellCoord | null;
  onRemoveAction: (index: number) => void;
  resolver: BCFResolver;
};

export function CellBar({
  conflicts,
  focus,
  onRemoveAction,
  resolver,
}: CellBarProps) {
  if (focus === null) {
    return (
      <span className={`${styles.cell} ${styles.none}`}>
        <i className="fa-solid fa-crosshairs" />
        No cell selected
      </span>
    );
  }

  const actor = resolver.getActor(focus.actorId)!;
  const actions = resolver.getCell(focus.actorId, focus.tick)?.actions ?? [];
  const conflict =
    conflicts.find(
      (c) => c.actorId === focus.actorId && c.tick === focus.tick,
    ) ?? null;

  return (
    <>
      <span className={styles.cell}>
        <i className="fa-solid fa-crosshairs" />
        {actor.name} <span className={styles.tick}>t{focus.tick}</span>
      </span>
      <i className={`fa-solid fa-angle-right ${styles.separator}`} />
      {actions.length === 0 ? (
        <span className={styles.empty}>Empty cell</span>
      ) : (
        actions.map((action, index) => (
          <ActionChip
            action={action}
            conflict={action.type === 'attack' ? conflict : null}
            key={action.type}
            onRemove={() => onRemoveAction(index)}
          />
        ))
      )}
    </>
  );
}

type ActionChipProps = {
  action: BCFAction;
  conflict: CooldownConflict | null;
  onRemove: () => void;
};

function ActionChip({ action, conflict, onRemove }: ActionChipProps) {
  return (
    <span
      className={
        conflict === null
          ? styles.action
          : `${styles.action} ${styles.conflict}`
      }
    >
      <ActionIcon action={action} size={22} />
      {actionName(action)}
      {action.type === 'attack' && (
        <span className={styles.meta}>
          {attackCooldown(action.attackType)}t
        </span>
      )}
      {conflict !== null && (
        <span className={styles.warning}>
          <i className="fa-solid fa-triangle-exclamation" />
          On cooldown until{' '}
          <span className={styles.tick}>t{conflict.offCooldownTick}</span>
        </span>
      )}
      <DismissButton label="Remove" onClick={onRemove} />
    </span>
  );
}
