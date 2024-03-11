import styles from './style.module.scss';

type StatisticProps = {
  name: string;
  value: number;
};

export default function Statistic(props: StatisticProps) {
  return (
    <div className={styles.statistic}>
      <div className={styles.value}>{props.value}</div>
      <div className={styles.name}>{props.name}</div>
    </div>
  );
}
