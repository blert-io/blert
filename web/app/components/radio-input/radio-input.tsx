'use client';

import React from 'react';
import styles from './style.module.scss';

type OptionProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  id: string;
  label: string | JSX.Element;
  privateName?: string;
  privateOnChange?: () => void;
  privateReadOnly?: boolean;
  value: number | string;
};

export function Option(props: OptionProps) {
  return (
    <div className={styles.radioOption}>
      <input
        checked={props.checked}
        defaultChecked={props.defaultChecked}
        id={props.id}
        onChange={props.privateOnChange}
        name={props.privateName}
        readOnly={props.privateReadOnly}
        type="radio"
        value={props.value}
      />
      <label htmlFor={props.id}>{props.label}</label>
    </div>
  );
}

type GroupProps = {
  children: React.ReactNode;
  name: string;
  onChange?: (value: number | string) => void;
  readOnly?: boolean;
};

export function Group(props: GroupProps) {
  return (
    <div className={styles.radioGroup}>
      {React.Children.map(props.children, (child) => {
        if (child === null || child === undefined) {
          return null;
        }

        const childElement = child as React.ReactElement<OptionProps>;

        return React.cloneElement<OptionProps>(childElement, {
          privateName: props.name,
          privateOnChange: () => props.onChange?.(childElement.props.value),
          privateReadOnly: props.readOnly,
        });
      })}
    </div>
  );
}
