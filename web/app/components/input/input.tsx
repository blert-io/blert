import { forwardRef } from 'react';

import styles from './style.module.scss';

export type InputProps = {
  autoFocus?: boolean;
  className?: string;
  customIcon?: React.ReactNode;
  disabled?: boolean;
  errorMessage?: string;
  faIcon?: string;
  fluid?: boolean;
  horizontalPadding?: number;
  id: string;
  inputClassName?: string;
  invalid?: boolean;
  label: string;
  labelBg?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  required?: boolean;
  type?: 'email' | 'number' | 'password' | 'text';
  value?: string;
  width?: number;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input(props, ref) {
    const labelBackground = props.labelBg ?? 'var(--panel-bg)';
    const style: React.CSSProperties = {
      width: props.fluid ? '100%' : (props.width ?? 240),
    };

    const paddingX = props.horizontalPadding ?? 15;
    style.padding = `12px ${paddingX}px`;

    let className = styles.input;
    if (props.className) {
      className += ` ${props.className}`;
    }
    if (props.invalid) {
      className += ` ${styles.invalid}`;
    }

    let icon = undefined;
    if (props.customIcon) {
      icon = <div className={styles.icon}>{props.customIcon}</div>;
    } else if (props.faIcon) {
      icon = props.faIcon && <i className={`${styles.icon} ${props.faIcon}`} />;
    }

    return (
      <div className={className}>
        <input
          autoComplete="off"
          autoFocus={props.autoFocus}
          className={props.inputClassName}
          disabled={props.disabled}
          id={props.id}
          maxLength={props.maxLength}
          minLength={props.minLength}
          name={props.id}
          onBlur={props.onBlur}
          onChange={props.onChange}
          onFocus={props.onFocus}
          onKeyDown={props.onKeyDown}
          pattern={props.pattern}
          placeholder=" "
          style={style}
          ref={ref}
          required={props.required}
          type={props.type ?? 'text'}
          value={props.value}
        />
        <label
          htmlFor={props.id}
          style={{ background: labelBackground, left: paddingX - 5 }}
        >
          {props.invalid && props.errorMessage
            ? props.errorMessage
            : props.label}
        </label>
        {icon}
      </div>
    );
  },
);
