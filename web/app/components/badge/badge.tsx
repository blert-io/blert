import styles from './style.module.scss';

type BadgeProps = {
  className?: string;
  iconClass: string;
  label: string;
  value: string | number;
};

export function Badge({ className, label, value, iconClass }: BadgeProps) {
  return (
    <div className={`${styles.badge} ${className ?? ''}`}>
      <strong>
        <i className={iconClass} style={{ paddingRight: '5px' }} />
        {label}:
      </strong>{' '}
      {value}
    </div>
  );
}
