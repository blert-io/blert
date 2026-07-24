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
  min?: number;
  max?: number;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  placeholder?: string;
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
    // The input always sets a placeholder so that `:placeholder-shown`
    // detects emptiness, so styling can't tell a real one from the blank
    // default without this.
    if (props.placeholder !== undefined) {
      className += ` ${styles.hasPlaceholder}`;
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
          min={props.min}
          max={props.max}
          onBlur={props.onBlur}
          onChange={props.onChange}
          onFocus={props.onFocus}
          onKeyDown={props.onKeyDown}
          pattern={props.pattern}
          placeholder={props.placeholder ?? ' '}
          style={style}
          ref={ref}
          required={props.required}
          type={props.type ?? 'text'}
          value={props.value}
        />
        <label
          htmlFor={props.id}
          style={
            {
              ['--input-label-bg']: props.labelBg,
              left: paddingX - 5,
            } as React.CSSProperties
          }
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
