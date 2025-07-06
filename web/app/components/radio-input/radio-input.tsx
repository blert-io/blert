'use client';

import React, { JSX } from 'react';
import styles from './style.module.scss';

type OptionProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
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
        disabled={props.disabled}
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
  className?: string;
  children: React.ReactNode;
  compact?: boolean;
  joined?: boolean;
  simple?: boolean;
  name: string;
  onChange?: (value: number | string) => void;
  readOnly?: boolean;
};

export function Group(props: GroupProps) {
  const classNames = [
    styles.radioGroup,
    props.className,
    props.joined && styles.joined,
    props.compact && styles.compact,
    props.simple && styles.simple,
  ].filter(Boolean);

  return (
    <div className={classNames.join(' ')}>
      {React.Children.map(props.children, (child) => {
        if (child === null || child === undefined) {
          return null;
        }

        const childElement = child as React.ReactElement<OptionProps>;

        return React.cloneElement<OptionProps>(childElement, {
          ...childElement.props,
          privateName: props.name,
          privateOnChange: () => props.onChange?.(childElement.props.value),
          privateReadOnly: props.readOnly,
        });
      })}
    </div>
  );
}
