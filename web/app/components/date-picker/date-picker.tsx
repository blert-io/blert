import ReactDatePicker, {
  DatePickerProps as ReactDatePickerProps,
} from 'react-datepicker';

import 'react-datepicker/dist/react-datepicker.css';
import './date-picker.css';

import styles from './style.module.scss';

// react-datepicker's props are a union containing single, range, and multiple
// selection modes, each with a different `onChange` signature. Blert only uses
// single date selection, so limit the props to that variant.
type SingleDatePickerProps = Extract<
  ReactDatePickerProps,
  { selectsRange?: false | undefined; selectsMultiple?: false | undefined }
>;

export type DatePickerProps = SingleDatePickerProps & {
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
