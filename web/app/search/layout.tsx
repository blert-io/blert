import { Suspense } from 'react';

import EntitySelector from './entity-selector';
import { FilterPanelProvider } from './filter-panel-context';
import FilterToggle from './filter-toggle';

import styles from './layout.module.scss';

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FilterPanelProvider>
      <div className={styles.searchLayout}>
        <div className={styles.topbar}>
          <Suspense fallback={<div className={styles.selectorFallback} />}>
            <EntitySelector />
          </Suspense>
          <div className={styles.topbarActions}>
            <FilterToggle />
          </div>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </FilterPanelProvider>
  );
}
