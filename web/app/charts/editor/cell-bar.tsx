'use client';

import { BCFAction, BCFResolver } from '@blert/bcf';

import { ActionIcon } from './action-icon';
import { actionName } from './action-registry';
import { attackCooldown } from './attack-cycle';
import { DismissButton } from './dismiss-button';
import { CellCoord } from './editor-state';

import styles from './cell-bar.module.scss';

type CellBarProps = {
  resolver: BCFResolver;
  focus: CellCoord | null;
  onRemoveAction: (index: number) => void;
};

export function CellBar({ resolver, focus, onRemoveAction }: CellBarProps) {
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
            key={action.type}
            action={action}
            onRemove={() => onRemoveAction(index)}
          />
        ))
      )}
    </>
  );
}

type ActionChipProps = {
  action: BCFAction;
  onRemove: () => void;
};

function ActionChip({ action, onRemove }: ActionChipProps) {
  return (
    <span className={styles.action}>
      <ActionIcon action={action} size={22} />
      {actionName(action)}
      {action.type === 'attack' && (
        <span className={styles.meta}>
          {attackCooldown(action.attackType)}t
        </span>
      )}
      <DismissButton label="Remove" onClick={onRemove} />
    </span>
  );
}
