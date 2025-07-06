'use client';

import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import styles from './style.module.scss';

type CustomButtonProps = {
  className?: string;
  onClick: () => void;
  icon: string;
  label: string;
};

/**
 * Map button which performs a custom, out of map action.
 */
export default function CustomButton({
  className,
  onClick,
  icon,
  label,
}: CustomButtonProps) {
  return (
    <button
      className={`${styles.mapButton} ${className ?? ''}`}
      onClick={onClick}
      data-tooltip-id={GLOBAL_TOOLTIP_ID}
      data-tooltip-content={label}
    >
      <i className={icon} />
      <span className="sr-only">{label}</span>
    </button>
  );
}
