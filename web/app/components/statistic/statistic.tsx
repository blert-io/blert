import styles from './style.module.scss';

type StatisticProps = {
  name: string;
  value: number | string;
  supplementalClassName?: string;
  showAsPercentage?: boolean;
};

export default function Statistic(props: StatisticProps) {
  const { supplementalClassName, showAsPercentage } = props;
  return (
    <div
      className={`${styles.statistic}${supplementalClassName ? ' ' + supplementalClassName : ''}`}
    >
      <div className={styles.value}>
        {props.value}
        {showAsPercentage ? '%' : ''}
      </div>
      <div className={styles.name}>{props.name}</div>
    </div>
  );
}
