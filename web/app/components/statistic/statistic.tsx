import styles from './style.module.scss';

type StatisticProps = {
  name: string;
  maxFontSize?: number;
  value: number | string;
  className?: string;
  width: number;
  height?: number;
  unit?: string;
  icon?: string | React.ReactNode;
  simple?: boolean;
};

export default function Statistic(props: StatisticProps) {
  const { className, unit, width, height, maxFontSize = 40, icon } = props;

  let value = props.value;
  if (typeof value === 'number') {
    value = value.toLocaleString();
  }
  if (props.unit !== undefined) {
    value += unit;
  }

  let fontSize = Math.max(maxFontSize - value.length * 2, 14);

  const classNames = [
    styles.statistic,
    className,
    props.simple && styles.simple,
  ].filter(Boolean);

  return (
    <div className={classNames.join(' ')} style={{ width, height }}>
      <div className={styles.label}>
        {typeof icon === 'string' ? (
          <i className={`${styles.icon} ${icon}`} />
        ) : icon ? (
          <div className={styles.icon}>{icon}</div>
        ) : null}
        {props.name}
      </div>
      <div
        className={styles.value}
        style={{ fontSize, height: Math.floor(maxFontSize * 1.1) }}
      >
        {value}
      </div>
    </div>
  );
}
