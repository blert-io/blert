'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { buildEntityHref } from './shared-filters';

import styles from './entity-selector.module.scss';

type Entity = {
  label: string;
  path: string;
  icon: string;
};

const ENTITIES: Entity[] = [
  { label: 'Challenges', path: '/search/challenges', icon: 'fas fa-list' },
  { label: 'Sessions', path: '/search/sessions', icon: 'fas fa-layer-group' },
];

export default function EntitySelector() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <nav className={styles.selector}>
      {ENTITIES.map((entity) => {
        const active = pathname === entity.path;
        const href = active
          ? entity.path
          : buildEntityHref(entity.path, searchParams);
        return (
          <Link
            key={entity.path}
            href={href}
            className={`${styles.entity} ${active ? styles.active : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <i className={entity.icon} />
            <span>{entity.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
