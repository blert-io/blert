import styles from './style.module.scss';

type InputProps = {
  disabled?: boolean;
  errorMessage?: string;
  faIcon?: string;
  fluid?: boolean;
  id: string;
  inputRef?: React.RefObject<HTMLInputElement>;
  invalid?: boolean;
  label: string;
  maxLength?: number;
  minLength?: number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  required?: boolean;
  type?: 'email' | 'password' | 'text';
  value?: string;
};

export function Input(props: InputProps) {
  const style = {
    width: props.fluid ? '100%' : undefined,
  };

  const className = styles.input + (props.invalid ? ` ${styles.invalid}` : '');

  return (
    <div className={className}>
      <input
        disabled={props.disabled}
        id={props.id}
        maxLength={props.maxLength}
        minLength={props.minLength}
        name={props.id}
        onKeyDown={props.onKeyDown}
        onChange={props.onChange}
        placeholder=" "
        style={style}
        ref={props.inputRef}
        required={props.required}
        type={props.type ?? 'text'}
        value={props.value}
      />
      <label htmlFor={props.id}>
        {props.invalid && props.errorMessage ? props.errorMessage : props.label}
      </label>
      {props.faIcon && <i className={`${styles.icon} ${props.faIcon}`} />}
    </div>
  );
}
