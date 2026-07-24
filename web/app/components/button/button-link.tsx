import Link from 'next/link';

import { ButtonStyleProps, buttonClassName } from './button';

export type ButtonLinkProps = ButtonStyleProps & {
  href: string;
  children: React.ReactNode;
  id?: string;
  fluid?: boolean;
  onClick?: () => void;
  target?: string;
  rel?: string;
  'data-tooltip-id'?: string;
  'data-tooltip-content'?: string;
};

/** A link that looks like a {@link Button}. */
export function ButtonLink(props: ButtonLinkProps) {
  return (
    <Link
      href={props.href}
      id={props.id}
      className={buttonClassName(props)}
      style={{
        width: props.fluid ? '100%' : undefined,
        fontSize: props.fontSize,
      }}
      onClick={props.onClick}
      target={props.target}
      rel={props.rel}
      data-tooltip-id={props['data-tooltip-id']}
      data-tooltip-content={props['data-tooltip-content']}
    >
      {props.children}
    </Link>
  );
}
