'use client';

import Link from 'next/link';
import React, { useCallback } from 'react';

type MdxHashLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

export function MdxHashLink({ href, children, ...rest }: MdxHashLinkProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      const id = href.slice(1);
      const el = document.getElementById(id);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth' });
        history.replaceState(null, '', href);
      }
    },
    [href],
  );

  return (
    <Link href={href} onClick={handleClick} replace {...rest}>
      {children}
    </Link>
  );
}
