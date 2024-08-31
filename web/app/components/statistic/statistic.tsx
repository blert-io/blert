import styles from './style.module.scss';

type StatisticProps = {
  name: string;
  maxFontSize?: number;
  value: number | string;
  className?: string;
  width: number;
  height?: number;
  unit?: string;
};

export default function Statistic(props: StatisticProps) {
  const { className, unit, width, height, maxFontSize = 40 } = props;

  let value = props.value;
  if (typeof value === 'number') {
    value = value.toLocaleString();
  }
  if (props.unit !== undefined) {
    value += unit;
  }

  let fontSize = Math.max(maxFontSize - value.length * 2, 14);

  return (
    <div
      className={`${styles.statistic}${className ? ' ' + className : ''}`}
      style={{ width, height }}
    >
      <div
        className={styles.value}
        style={{ fontSize, height: Math.floor(maxFontSize * 1.1) }}
      >
        {value}
      </div>
      <div className={styles.name}>{props.name}</div>
    </div>
  );
}
