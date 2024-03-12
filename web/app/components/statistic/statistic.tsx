import styles from './style.module.scss';

type StatisticProps = {
  name: string;
  value: number | string;
  supplementalClassName?: string;
  width: number;
  unit?: string;
};

export default function Statistic(props: StatisticProps) {
  const { supplementalClassName, unit } = props;

  let value = props.value;
  if (typeof value === 'number') {
    value = value.toLocaleString();
  }
  if (props.unit !== undefined) {
    value += props.unit;
  }

  let fontSize = Math.max(40 - value.length * 2, 14);

  return (
    <div
      className={`${styles.statistic}${supplementalClassName ? ' ' + supplementalClassName : ''}`}
      style={{ width: props.width }}
    >
      <div className={styles.value} style={{ fontSize }}>
        {value}
      </div>
      <div className={styles.name}>{props.name}</div>
    </div>
  );
}
