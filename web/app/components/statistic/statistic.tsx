import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import styles from './style.module.scss';

type StatisticProps = {
  name: string;
  maxFontSize?: number;
  value: number | string;
  className?: string;
  valueClassName?: string;
  width?: number;
  height?: number;
  unit?: string;
  icon?: string | React.ReactNode;
  simple?: boolean;
  label?: 'top' | 'bottom';
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
    label: labelPosition = 'top',
  } = props;

  let value = props.value;
  if (typeof value === 'number') {
    value = value.toLocaleString();
  }
  if (props.unit !== undefined) {
    value += unit;
  }

  const fontSize = Math.max(maxFontSize - value.length * 2, 14);

  const classNames = [
    styles.statistic,
    className,
    props.simple && styles.simple,
  ].filter(Boolean);

  const tooltipProperties: Record<string, string> = {};
  if (tooltip) {
    tooltipProperties['data-tooltip-id'] = GLOBAL_TOOLTIP_ID;
    tooltipProperties['data-tooltip-content'] = tooltip;
  }

  const label = (
    <div key="label" className={styles.label}>
      {typeof icon === 'string' ? (
        <i className={`${styles.icon} ${icon}`} />
      ) : icon ? (
        <div className={styles.icon}>{icon}</div>
      ) : null}
      {props.name}
    </div>
  );
  const val = (
    <div
      key="value"
      className={[styles.value, props.valueClassName].filter(Boolean).join(' ')}
      style={{ fontSize, height: Math.floor(maxFontSize * 1.1) }}
    >
      {value}
    </div>
  );

  return (
    <div
      className={classNames.join(' ')}
      style={{ width, height }}
      {...tooltipProperties}
    >
      {labelPosition === 'top' ? label : val}
      {labelPosition === 'bottom' ? label : val}
      {tooltip && <i className={`${styles.helpIcon} far fa-question-circle`} />}
    </div>
  );
}
