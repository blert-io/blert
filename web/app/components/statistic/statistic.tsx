import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

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
  tooltip?: string;
};

export default function Statistic(props: StatisticProps) {
  const {
    className,
    unit,
    width,
    height,
    maxFontSize = 40,
    icon,
    tooltip,
  } = props;

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

  let tooltipProperties: Record<string, string> = {};
  if (tooltip) {
    tooltipProperties['data-tooltip-id'] = GLOBAL_TOOLTIP_ID;
    tooltipProperties['data-tooltip-content'] = tooltip;
  }

  return (
    <div
      className={classNames.join(' ')}
      style={{ width, height }}
      {...tooltipProperties}
    >
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
      {tooltip && <i className={`${styles.helpIcon} far fa-question-circle`} />}
    </div>
  );
}
