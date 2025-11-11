'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import TimeAgo from 'react-timeago';

import { SetupListItem } from '@/actions/setup';
import Card from '@/components/card';
import { useToast } from '@/components/toast';

import DeleteModal from './delete-modal';
import { setupLocalStorage } from './local-storage';
import { MAX_LOCAL_SETUPS } from './setup';

import styles from './local-setups-list.module.scss';
import { challengeName } from '@blert/common';

export default function LocalSetupsList() {
  const showToast = useToast();

  const [localSetups, setLocalSetups] = useState<SetupListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLocalSetups = useCallback(async () => {
    const setups = setupLocalStorage.listSetups();
    setLocalSetups(setups);
    setLoading(false);
  }, [setLocalSetups, setLoading]);

  useEffect(() => {
    loadLocalSetups();
  }, [loadLocalSetups]);

  if (loading) {
    return (
      <Card className={styles.localSetupsSection}>
        <div className={styles.loading}>
          <i className="fas fa-spinner fa-spin" />
          <span>Loading your setups...</span>
        </div>
      </Card>
    );
  }

  return (
    <Card
      header={{
        title: (
          <div className={styles.sectionTitle}>
            <i className="fas fa-hard-drive" />
            Your Local Setups
            <span className={styles.badge}>
              {localSetups.length}/{MAX_LOCAL_SETUPS}
            </span>
          </div>
        ),
      }}
      className={styles.localSetupsCard}
    >
      <div className={styles.localNotice}>
        <i className="fas fa-info-circle" />
        <div className={styles.noticeContent}>
          <p>
            <strong>These setups are stored locally in your browser.</strong>
          </p>
          <p>
            <Link href="/register">Create a free account</Link> to save
            unlimited setups, share them with others, and access them from any
            device.
          </p>
        </div>
      </div>

      {localSetups.length > 0 ? (
        <div className={styles.setupsList}>
          {localSetups.map((setup) => (
            <LocalSetupCard
              key={setup.publicId}
              setup={setup}
              onDelete={loadLocalSetups}
            />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <i className="fas fa-folder-open" />
          <h3>No local setups yet</h3>
          <p>Create your first gear setup to get started!</p>
          <Link href="/setups/new" className={styles.emptyStateButton}>
            <i className="fas fa-plus" />
            Create Your First Setup
          </Link>
        </div>
      )}
    </Card>
  );
}

function LocalSetupCard({
  setup,
  onDelete,
}: {
  setup: SetupListItem;
  onDelete: () => void;
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  function handleDelete() {
    setShowDeleteModal(false);
    onDelete();
  }

  return (
    <>
      <div className={styles.setupCard}>
        <Link
          href={`/setups/${setup.publicId}/edit`}
          className={styles.setupLink}
        >
          <div className={styles.setupHeader}>
            <div className={styles.setupIcon}>
              <i className="fas fa-hard-drive" />
            </div>
            <div className={styles.setupInfo}>
              <h3>{setup.name}</h3>
              <div className={styles.setupMeta}>
                <span>
                  <i className="fas fa-shield" />
                  {challengeName(setup.challengeType)}
                </span>
                <span>
                  <i className="fas fa-clock" />
                  Edited <TimeAgo date={setup.updatedAt ?? setup.createdAt} />
                </span>
              </div>
            </div>
          </div>
        </Link>
        <div className={styles.setupActions}>
          <Link
            href={`/setups/${setup.publicId}/edit`}
            className={styles.editButton}
          >
            <i className="fas fa-edit" />
            <span>Edit</span>
          </Link>
          <button
            onClick={() => setShowDeleteModal(true)}
            className={styles.deleteButton}
          >
            <i className="fas fa-trash" />
            <span>Delete</span>
          </button>
        </div>
      </div>
      <DeleteModal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onDelete={handleDelete}
        setupId={setup.publicId}
        title={setup.name}
        isLocal
      />
    </>
  );
}
