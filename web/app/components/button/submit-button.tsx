'use client';

import { useFormStatus } from 'react-dom';

import { Button, ButtonProps } from './button';

export function SubmitButton(props: Omit<ButtonProps, 'type'>) {
  const { pending } = useFormStatus();
  return <Button {...props} loading={props.loading || pending} type="submit" />;
}
