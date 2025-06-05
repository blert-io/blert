import ReactDatePicker, {
  DatePickerProps as ReactDatePickerProps,
} from 'react-datepicker';

import 'react-datepicker/dist/react-datepicker.css';
import './date-picker.css';

import styles from './style.module.scss';

export type DatePickerProps = ReactDatePickerProps & {
  width?: number | string;
};

export default function DatePicker(props: DatePickerProps) {
  const { width, ...rest } = props;

  return (
    <ReactDatePicker
      {...rest}
      customInput={<input className={styles.dateInput} style={{ width }} />}
      popperClassName="blert-datepicker"
      portalId="portal-root"
      wrapperClassName="blert-datepicker-wrapper"
    />
  );
}
