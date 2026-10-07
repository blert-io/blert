import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import styles from './dismiss-button.module.scss';

type DismissButtonProps = {
  label: string;
  onClick: () => void;
};

export function DismissButton({ label, onClick }: DismissButtonProps) {
  return (
    <button
      aria-label={label}
      className={styles.button}
      data-tooltip-id={GLOBAL_TOOLTIP_ID}
      data-tooltip-content={label}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      type="button"
    >
      <i className="fa-solid fa-xmark" />
    </button>
  );
}
