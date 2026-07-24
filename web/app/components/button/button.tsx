import Spinner from '../spinner';
import { GLOBAL_TOOLTIP_ID } from '../tooltip';

import styles from './style.module.scss';

export type ButtonVariant = 'primary' | 'danger';

/** Shared appearance props for the button and its link twin. */
export type ButtonStyleProps = {
  className?: string;
  /** Renders as a small square tile without chrome. */
  icon?: boolean;
  simple?: boolean;
  variant?: ButtonVariant;
  fontSize?: string | number;
};

export function buttonClassName(props: ButtonStyleProps): string {
  const variant = props.variant ?? 'primary';
  let className = `${styles.button} ${styles[variant]}`;
  if (props.className) {
    className += ` ${props.className}`;
  }
  if (props.simple) {
    className += ` ${styles.simple}`;
  }
  if (props.icon) {
    className += ` ${styles.iconButton}`;
  }
  return className;
}

export type ButtonProps = ButtonStyleProps & {
  children: React.ReactNode;
  disabled?: boolean;
  id?: string;
  fluid?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  tooltip?: string;
  'aria-pressed'?: boolean;
  'data-tooltip-id'?: string;
  'data-tooltip-content'?: string;
};

export function Button(props: ButtonProps) {
  const { disabled = false, loading = false } = props;

  const style = {
    width: props.fluid ? '100%' : undefined,
    fontSize: props.fontSize,
  };

  const tooltipId =
    props['data-tooltip-id'] ??
    (props.tooltip !== undefined ? GLOBAL_TOOLTIP_ID : undefined);

  return (
    <button
      className={buttonClassName(props)}
      disabled={disabled || loading}
      id={props.id}
      onClick={props.onClick}
      style={style}
      type={props.type ?? 'button'}
      aria-pressed={props['aria-pressed']}
      data-tooltip-id={tooltipId}
      data-tooltip-content={props['data-tooltip-content'] ?? props.tooltip}
    >
      {props.loading ? <Spinner /> : props.children}
    </button>
  );
}
