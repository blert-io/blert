import { ReactNode } from 'react';

import { ButtonLink } from '@/components/button';

import styles from './style.module.scss';

export type CardProps = {
  children: ReactNode;
  className?: string;
  primary?: boolean;
  fixed?: boolean;
  header?: {
    title: ReactNode;
    action?: ReactNode;
    styles?: React.CSSProperties;
  };
};

export function Card({
  children,
  className,
  primary = false,
  fixed = false,
  header,
}: CardProps) {
  const cardClasses = [
    styles.card,
    primary && styles.primary,
    fixed && styles.fixed,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cardClasses}>
      {header && (
        <div className={styles.cardHeader} style={header.styles}>
          <h2>{header.title}</h2>
          {header.action}
        </div>
      )}
      {children}
    </div>
  );
}

export function CardLink({ href, text }: { href: string; text: string }) {
  return (
    <ButtonLink
      href={href}
      simple
      fontSize="0.9rem"
      className={styles.cardLink}
    >
      {text} <i className="fas fa-arrow-right" />
    </ButtonLink>
  );
}
