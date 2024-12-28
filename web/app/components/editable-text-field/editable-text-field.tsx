'use client';

import { ElementType, useEffect, useState } from 'react';

import styles from './style.module.scss';

type EditableTextFieldProps = {
  className?: string;
  value: string;
  onChange: (value: string) => void;
  tag: ElementType;
  inputTag?: 'input' | 'textarea';
  width: number | string;
};

export function EditableTextField(props: EditableTextFieldProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(props.value);

  useEffect(() => setValue(props.value), [props.value]);

  function stopEditing() {
    setEditing(false);
    props.onChange(value);
  }

  const Tag = props.tag as any;
  const InputTag = props.inputTag || 'input';
  const style: React.CSSProperties = { width: props.width };

  const className = props.className
    ? `${styles.editable} ${props.className}`
    : styles.editable;

  if (!editing) {
    return (
      <Tag className={className} style={style}>
        <span className={styles.text}>{props.value}</span>
        <button className={styles.button} onClick={() => setEditing(true)}>
          <i className="fas fa-pencil-alt" />
          <span className="sr-only">Edit name</span>
        </button>
      </Tag>
    );
  }

  const isTextarea = InputTag === 'textarea';

  return (
    <Tag className={className} style={style}>
      <InputTag
        autoFocus
        className={styles.input}
        onBlur={() => {
          if (!isTextarea) {
            stopEditing();
          }
        }}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (!isTextarea && e.key === 'Enter') {
            stopEditing();
          }
        }}
        value={value}
      />
      <button className={styles.button} onClick={stopEditing}>
        <i className="fas fa-check" />
        <span className="sr-only">Confirm</span>
      </button>
    </Tag>
  );
}
