import Link from 'next/link';

import styles from './style.module.scss';

type HeadingProps = React.HTMLAttributes<HTMLHeadingElement> & {
  className?: string;
  id?: string;
  idPrefix?: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
};

export function Heading({
  className,
  level,
  text,
  id: userId,
  idPrefix,
  ...headingProps
}: HeadingProps) {
  let id: string;

  if (userId) {
    id = userId;
  } else {
    id = text
      .toLowerCase()
      .replace(/ /g, '-')
      .replace(/[^a-z0-9-]/g, '');
    if (idPrefix) {
      id = `${idPrefix}-${id}`;
    }
  }

  let fullClass = styles.heading;
  if (className) {
    fullClass += ` ${className}`;
  }

  const Tag = `h${level}` as any;

  return (
    <Tag {...headingProps} className={fullClass} id={id}>
      <i className="fas fa-link" />
      <Link href={`#${id}`}>{text}</Link>
    </Tag>
  );
}
