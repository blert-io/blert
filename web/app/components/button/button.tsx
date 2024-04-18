import styles from './style.module.scss';

type ButtonProps = {
  className?: string;
  children: React.ReactNode;
  disabled?: boolean;
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
