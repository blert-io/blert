import Spinner from '../spinner';

import styles from './style.module.scss';

export type ButtonProps = {
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
  id?: string;
  fluid?: boolean;
  loading?: boolean;
  onClick?: () => void;
  simple?: boolean;
  type?: 'button' | 'submit';
};

export function Button(props: ButtonProps) {
  let className = styles.button;
  if (props.className) {
    className += ` ${props.className}`;
  }
  if (props.simple) {
    className += ` ${styles.simple}`;
  }

  return (
    <button
      className={className}
      disabled={props.disabled || props.loading}
      id={props.id}
      onClick={props.onClick}
      style={{ width: props.fluid ? '100%' : undefined }}
      type={props.type ?? 'button'}
    >
      {props.loading ? <Spinner /> : props.children}
    </button>
  );
}
