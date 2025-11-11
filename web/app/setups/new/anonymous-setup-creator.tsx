'use client';

import { challengeName } from '@blert/common';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import TimeAgo from 'react-timeago';

import { SetupListItem } from '@/actions/setup';
import Button from '@/components/button';
import Modal from '@/components/modal';
import { useToast } from '@/components/toast';

import { setupLocalStorage } from '../local-storage';
import { MAX_LOCAL_SETUPS, NEW_GEAR_SETUP } from '../setup';

import styles from './style.module.scss';

export function AnonymousSetupCreator() {
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [existingSetups, setExistingSetups] = useState<SetupListItem[]>([]);

  const router = useRouter();
  const showToast = useToast();

  const createSetup = useCallback(() => {
    const array = new Uint8Array(8);
    crypto.getRandomValues(array);
    const hex = Array.from(array, (b) => b.toString(16).padStart(2, '0')).join(
      '',
    );
    const publicId = `local-${hex}`;
    setupLocalStorage.saveSetup(publicId, NEW_GEAR_SETUP);
    router.replace(`/setups/${publicId}/edit`);
  }, [router]);

  useEffect(() => {
    async function checkAndCreateSetup() {
      const localSetups = setupLocalStorage.listSetups();
      setExistingSetups(
        localSetups.toSorted(
          (a, b) =>
            (a.updatedAt?.getTime() ?? 0) - (b.updatedAt?.getTime() ?? 0),
        ),
      );

      const canCreate = localSetups.length < MAX_LOCAL_SETUPS;
      if (!canCreate) {
        setShowLimitModal(true);
        return;
      }

      createSetup();
    }

    checkAndCreateSetup();
  }, [createSetup]);

  function handleReplace(setup: SetupListItem) {
    setupLocalStorage.deleteSetup(setup.publicId);
    showToast(`Deleted "${setup.name}" and created new setup`, 'success');
    createSetup();
  }

  return (
    <div>
      <SetupLimitModal
        open={showLimitModal}
        onClose={() => router.push('/setups')}
        existingSetups={existingSetups}
        onReplace={handleReplace}
        onSignup={() => router.push('/register?next=/setups/new')}
      />
    </div>
  );
}

function SetupLimitModal({
  open,
  onClose,
  existingSetups,
  onReplace,
  onSignup,
}: {
  open: boolean;
  onClose: () => void;
  existingSetups: SetupListItem[];
  onReplace: (setup: SetupListItem) => void;
  onSignup: () => void;
}) {
  const [view, setView] = useState<'options' | 'select'>('options');
  const [selectedSetup, setSelectedSetup] = useState<SetupListItem | null>(
    null,
  );

  const oldestSetup = existingSetups[0];

  const handleReplaceOldest = () => {
    onReplace(oldestSetup);
  };

  const handleReplaceSelected = () => {
    if (selectedSetup) {
      onReplace(selectedSetup);
    }
  };

  let content;

  if (view === 'select') {
    content = (
      <>
        <div className={styles.header}>
          <button onClick={() => setView('options')}>
            <i className="fas fa-arrow-left" />
          </button>
          <h2>Choose Setup to Replace</h2>
        </div>

        <div className={styles.setupList}>
          {existingSetups.map((setup) => (
            <div
              key={setup.publicId}
              className={`${styles.setupCard} ${
                selectedSetup?.publicId === setup.publicId
                  ? styles.selected
                  : ''
              }`}
              onClick={() => setSelectedSetup(setup)}
            >
              <div className={styles.setupInfo}>
                <h3>{setup.name}</h3>
                <div className={styles.meta}>
                  <span>
                    <i className="fas fa-shield" />
                    {challengeName(setup.challengeType)}
                  </span>
                  {setup.updatedAt && (
                    <span>
                      <i className="fas fa-clock" />
                      Edited <TimeAgo date={setup.updatedAt} />
                    </span>
                  )}
                </div>
              </div>
              {selectedSetup?.publicId === setup.publicId && (
                <i className="fas fa-check-circle" />
              )}
            </div>
          ))}
        </div>

        <div className={styles.actions}>
          <Button onClick={() => setView('options')} simple>
            Cancel
          </Button>
          <Button
            onClick={handleReplaceSelected}
            disabled={!selectedSetup}
            className={styles.delete}
          >
            Delete & Create New
          </Button>
        </div>
      </>
    );
  } else {
    content = (
      <>
        <div className={styles.header}>
          <h2>Local Setup Limit Reached</h2>
          <button onClick={onClose}>
            <i className="fas fa-times" />
          </button>
        </div>

        <p className={styles.description}>
          You&apos;ve reached the maximum of {MAX_LOCAL_SETUPS} local setups.
          Pick an option to keep going:
        </p>

        <div className={styles.options}>
          <div className={styles.option}>
            <div className={styles.optionHeader}>
              <i className="fas fa-clock-rotate-left" />
              <h3>Replace Oldest</h3>
            </div>
            {oldestSetup && (
              <div className={styles.setupPreview}>
                <span className={styles.title}>{oldestSetup.name}</span>
                {oldestSetup.updatedAt && (
                  <span className={styles.meta}>
                    Last edited <TimeAgo date={oldestSetup.updatedAt} />
                  </span>
                )}
              </div>
            )}
            <Button onClick={handleReplaceOldest} className={styles.delete}>
              <i className="fas fa-trash" />
              Delete & Create New
            </Button>
          </div>

          <div className={styles.option}>
            <div className={styles.optionHeader}>
              <i className="fas fa-list" />
              <h3>Choose Setup to Replace</h3>
            </div>
            <p className={styles.optionDescription}>
              Pick a specific setup to delete
            </p>
            <Button onClick={() => setView('select')}>
              <i className="fas fa-hand-pointer" />
              Select Setup
            </Button>
          </div>

          <div className={`${styles.option} ${styles.signupOption}`}>
            <div className={styles.optionHeader}>
              <i className="fas fa-star" />
              <h3>Sign Up for Unlimited</h3>
            </div>
            <ul className={styles.benefits}>
              <li>
                <i className="fas fa-check" />
                Create unlimited setups
              </li>
              <li>
                <i className="fas fa-check" />
                Share with the community
              </li>
              <li>
                <i className="fas fa-check" />
                Cloud backup - never lose work
              </li>
              <li>
                <i className="fas fa-check" />
                Access from any device
              </li>
            </ul>
            <Button onClick={onSignup}>
              <i className="fas fa-user-plus" />
              Create Free Account
            </Button>
          </div>
        </div>
        <div className={styles.footer}>
          <button onClick={onClose} className={styles.cancelLink}>
            Cancel
          </button>
        </div>
      </>
    );
  }

  return (
    <Modal open={open} onClose={onClose} className={styles.limitModal}>
      {content}
    </Modal>
  );
}
