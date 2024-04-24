import styles from './style.module.scss';

export type ButtonProps = {
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
  fluid?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
};

export function Button(props: ButtonProps) {
  const className =
    styles.button + (props.className ? ` ${props.className}` : '');

  return (
    <button
      className={className}
      disabled={props.disabled || props.loading}
      style={{ width: props.fluid ? '100%' : undefined }}
      type={props.type}
    >
      {props.loading ? (
        <div className={styles.spinner}>
          <div />
          <div />
          <div />
          <div />
        </div>
      ) : (
        props.children
      )}
    </button>
  );
}
