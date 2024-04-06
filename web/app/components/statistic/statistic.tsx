import styles from './style.module.scss';

type StatisticProps = {
  name: string;
  value: number | string;
  className?: string;
  width: number;
  height?: number;
  unit?: string;
};

export default function Statistic(props: StatisticProps) {
  const { className, unit, width, height } = props;

  let value = props.value;
  if (typeof value === 'number') {
    value = value.toLocaleString();
  }
  if (props.unit !== undefined) {
    value += unit;
  }

  let fontSize = Math.max(40 - value.length * 2, 14);

  return (
    <div
      className={`${styles.statistic}${className ? ' ' + className : ''}`}
      style={{ width, height }}
    >
      <div className={styles.value} style={{ fontSize }}>
        {value}
      </div>
      <div className={styles.name}>{props.name}</div>
    </div>
  );
}
