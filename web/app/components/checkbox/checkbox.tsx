import styles from './style.module.scss';

type CheckboxProps = {
  checked?: boolean;
  className?: string;
  label: string;
  onChange?: (value: boolean) => void;
  simple?: boolean;
};

export default function Checkbox(props: CheckboxProps) {
  const { label, checked, onChange, simple = false } = props;
  let className = styles.checkbox;

  if (!simple) {
    className += ` ${styles.button}`;
  }

  if (props.className) {
    className += ` ${props.className}`;
  }

  return (
    <label className={className}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      {label}
    </label>
  );
}
