'use client';

import { challengeName } from '@blert/common';
import Link from 'next/link';

import { SetupListItem } from '@/actions/setup';
import VoteBar from '@/components/vote-bar';

import styles from './setup-list.module.scss';

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

type StaticSetupListProps = {
  setups: SetupListItem[];
  showState?: boolean;
  className?: string;
};

export function StaticSetupList({
  setups,
  showState,
  className,
}: StaticSetupListProps) {
  return (
    <div className={`${styles.setupList} ${className ?? ''}`}>
      <div className={styles.setupsList}>
        {setups.length > 0 ? (
          setups.map((setup) => (
            <Link
              key={setup.publicId}
              href={`/setups/${setup.publicId}${
                setup.state === 'draft' ? '/edit' : ''
              }`}
              className={styles.setupCard}
            >
              <div className={styles.setupHeader}>
                <div className={styles.setupTitle}>
                  <h3>{setup.name}</h3>
                  <div className={styles.setupMeta}>
                    {!showState && (
                      <span className={styles.author}>
                        <i className="fas fa-user" />
                        {setup.author}
                      </span>
                    )}
                    <span className={styles.meta}>
                      <i className="fas fa-shield" />
                      {challengeName(setup.challengeType)}
                    </span>
                    {showState && (
                      <span
                        className={`${styles.meta} ${styles.state} ${styles[setup.state]}`}
                      >
                        <i
                          className={`fas ${
                            setup.state === 'draft'
                              ? 'fa-edit'
                              : setup.state === 'published'
                                ? 'fa-check-circle'
                                : 'fa-archive'
                          }`}
                        />
                        {setup.state}
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.setupStats}>
                  <VoteBar
                    likes={setup.likes}
                    dislikes={setup.dislikes}
                    currentVote={null}
                    disabled
                    width={200}
                  />
                  <div className={styles.views}>
                    <i className="fas fa-eye" />
                    <span>{setup.views.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className={styles.setupFooter}>
                <div className={styles.dates}>
                  <span className={styles.date}>
                    <i className="fas fa-calendar-plus" />
                    Created {formatDate(setup.createdAt)}
                  </span>
                  {setup.updatedAt && (
                    <span className={styles.date}>
                      <i className="fas fa-calendar-edit" />
                      Updated {formatDate(setup.updatedAt)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))
        ) : (
          <div className={styles.emptyState}>
            <i className="fas fa-search" />
            <h3>No setups found</h3>
          </div>
        )}
      </div>
    </div>
  );
}
