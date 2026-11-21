'use client';

import React, { ElementType, useEffect, useRef, useState } from 'react';

import styles from './style.module.scss';

type EditableTextFieldProps = {
  className?: string;
  value: string;
  onChange: (value: string) => void;
  tag: ElementType;
  width: number | string;
};

export function EditableTextField(props: EditableTextFieldProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(props.value);
  const justStoppedEditing = useRef(false);

  useEffect(() => setValue(props.value), [props.value]);

  function stopEditing() {
    setEditing(false);
    props.onChange(value);
    justStoppedEditing.current = true;
    setTimeout(() => {
      justStoppedEditing.current = false;
    }, 200);
  }

  function startEditing() {
    if (justStoppedEditing.current) {
      return;
    }
    setEditing(true);
  }

  const Tag = props.tag as React.ElementType<React.HTMLAttributes<HTMLElement>>;
  const style: React.CSSProperties = { width: props.width };

  const className = props.className
    ? `${styles.editable} ${props.className}`
    : styles.editable;

  if (!editing) {
    return (
      <Tag className={className} style={style}>
        <span className={styles.text} onClick={startEditing}>
          {props.value}
        </span>
        <button className={styles.button} onClick={startEditing}>
          <i className="fas fa-pencil-alt" />
          <span className="sr-only">Edit name</span>
        </button>
      </Tag>
    );
  }

  return (
    <Tag className={className} style={style}>
      <input
        autoFocus
        className={styles.input}
        onBlur={stopEditing}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            stopEditing();
          }
        }}
        value={value}
      />
      <button
        className={styles.button}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          stopEditing();
        }}
      >
        <i className="fas fa-check" />
        <span className="sr-only">Confirm</span>
      </button>
    </Tag>
  );
}
