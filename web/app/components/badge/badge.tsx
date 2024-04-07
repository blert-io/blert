import styles from './style.module.scss';

type BadgeProps = {
  iconClass: string;
  label: string;
  value: string | number;
};

export function Badge({ label, value, iconClass }: BadgeProps) {
  return (
    <div className={styles.badge}>
      <strong>
        <i className={iconClass} style={{ paddingRight: '5px' }} />
        {label}:
      </strong>{' '}
      {value}
    </div>
  );
}
