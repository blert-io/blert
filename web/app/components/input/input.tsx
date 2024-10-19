import { forwardRef } from 'react';

import styles from './style.module.scss';

export type InputProps = {
  customIcon?: React.ReactNode;
  disabled?: boolean;
  errorMessage?: string;
  faIcon?: string;
  fluid?: boolean;
  id: string;
  invalid?: boolean;
  label: string;
  labelBg?: string;
  maxLength?: number;
  minLength?: number;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  required?: boolean;
  type?: 'email' | 'password' | 'text';
  value?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => {
  const labelBackground = props.labelBg ?? 'var(--panel-bg)';
  const style = {
    width: props.fluid ? '100%' : undefined,
  };

  const className = styles.input + (props.invalid ? ` ${styles.invalid}` : '');

  let icon = undefined;
  if (props.customIcon) {
    icon = <div className={styles.icon}>{props.customIcon}</div>;
  } else if (props.faIcon) {
    icon = props.faIcon && <i className={`${styles.icon} ${props.faIcon}`} />;
  }

  return (
    <div className={className}>
      <input
        disabled={props.disabled}
        id={props.id}
        maxLength={props.maxLength}
        minLength={props.minLength}
        name={props.id}
        onBlur={props.onBlur}
        onChange={props.onChange}
        onFocus={props.onFocus}
        onKeyDown={props.onKeyDown}
        placeholder=" "
        style={style}
        ref={ref}
        required={props.required}
        type={props.type ?? 'text'}
        value={props.value}
      />
      <label htmlFor={props.id} style={{ background: labelBackground }}>
        {props.invalid && props.errorMessage ? props.errorMessage : props.label}
      </label>
      {icon}
    </div>
  );
});
