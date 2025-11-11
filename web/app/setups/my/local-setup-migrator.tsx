'use client';

import { challengeName } from '@blert/common';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  migrateLocalSetup,
  SetupListItem,
  SetupMetadata,
} from '@/actions/setup';
import Button from '@/components/button';
import { useToast } from '@/components/toast';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import { setupLocalStorage } from '../local-storage';

import styles from './style.module.scss';

async function migrateSetup(id: string): Promise<SetupMetadata> {
  const setup = setupLocalStorage.loadSetup(id);
  if (setup === null) {
    throw new Error('Local setup not found');
  }
  if (setup.draft === null) {
    throw new Error('Local setup has no draft');
  }

  const newSetup = await migrateLocalSetup(setup.draft);
  setupLocalStorage.deleteSetup(setup.publicId);
  return newSetup;
}

export function LocalSetupMigrator() {
  const params = useSearchParams();
  const router = useRouter();
  const showToast = useToast();

  const [localSetups, setLocalSetups] = useState<SetupListItem[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleMigrateSingle = useCallback(
    async (idToMigrate: string, redirect: boolean = false) => {
      setMigrating(true);
      try {
        const newSetup = await migrateSetup(idToMigrate);
        showToast(`Migrated "${newSetup.name}" to the server`, 'success');
        if (redirect) {
          router.push(`/setups/${newSetup.publicId}/edit`);
        } else {
          setLocalSetups(setupLocalStorage.listSetups());
        }
      } catch (e) {
        showToast((e as Error).message, 'error');
      } finally {
        setMigrating(false);
      }
    },
    [showToast, router],
  );

  const handleMigrateAll = useCallback(async () => {
    setMigrating(true);
    const localSetups = setupLocalStorage.listSetups();

    let migrated = 0;
    let failed = 0;

    for (const setup of localSetups) {
      try {
        await migrateSetup(setup.publicId);
        migrated++;
      } catch (e) {
        failed++;
      }
    }

    setMigrating(false);

    if (failed > 0) {
      showToast(`Failed to migrate ${failed} setups`, 'error');
    }

    if (migrated > 0) {
      showToast(`Migrated ${migrated} setups`, 'success');
    }

    setLocalSetups(setupLocalStorage.listSetups());
  }, [showToast, setLocalSetups]);

  const handleDelete = useCallback(
    async (id: string) => {
      setupLocalStorage.deleteSetup(id);
      showToast('Deleted setup', 'success');
      setLocalSetups(setupLocalStorage.listSetups());
    },
    [showToast, setLocalSetups],
  );

  useEffect(() => {
    const localSetups = setupLocalStorage.listSetups();
    setLocalSetups(localSetups);
  }, [setLocalSetups]);

  useEffect(() => {
    const idToMigrate = params.get('migrate');
    if (idToMigrate === null) {
      return;
    }

    if (idToMigrate.startsWith('local-')) {
      handleMigrateSingle(idToMigrate, true);
    }
  }, [params, handleMigrateSingle]);

  if (localSetups.length === 0 || dismissed) {
    return null;
  }

  return (
    <div className={styles.migrationBanner}>
      <div className={styles.bannerHeader}>
        <div className={styles.iconWrapper}>
          <div className={styles.iconPulse} />
          <i className="fas fa-cloud-arrow-up" />
        </div>
        <div className={styles.headerContent}>
          <h3>
            <i className="fas fa-exclamation-circle" />
            Local Setups Found
          </h3>
          <p>
            You have <strong>{localSetups.length}</strong> setup
            {localSetups.length !== 1 ? 's' : ''} saved locally in your browser.
            Migrate them to your account for cloud backup and sharing.
          </p>
        </div>
      </div>

      <div className={styles.bannerBody}>
        <button
          onClick={() => setExpanded(!expanded)}
          className={styles.toggleButton}
        >
          <span>
            {expanded ? 'Hide' : 'Show'} setups ({localSetups.length})
          </span>
          <i className={`fas fa-chevron-${expanded ? 'up' : 'down'}`} />
        </button>

        {expanded && (
          <div className={styles.setupsList}>
            {localSetups.map((setup) => (
              <div key={setup.publicId} className={styles.setupItem}>
                <div className={styles.setupIcon}>
                  <i className="fas fa-hard-drive" />
                </div>
                <div className={styles.setupInfo}>
                  <span className={styles.setupName}>{setup.name}</span>
                  <div className={styles.setupMeta}>
                    <span>
                      <i className="fas fa-shield" />
                      {challengeName(setup.challengeType)}
                    </span>
                    <span>
                      <i className="fas fa-clock" />
                      {new Date(
                        setup.updatedAt || setup.createdAt,
                      ).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className={styles.setupActions}>
                  <Button
                    onClick={() => handleMigrateSingle(setup.publicId)}
                    className={`${styles.button} ${styles.migrateButton}`}
                    simple
                    disabled={migrating}
                    loading={migrating}
                    data-tooltip-id={GLOBAL_TOOLTIP_ID}
                    data-tooltip-content="Migrate setup"
                  >
                    <i className="fas fa-cloud-arrow-up" />
                    <span className="sr-only">Migrate setup</span>
                  </Button>
                  <Button
                    onClick={() => handleDelete(setup.publicId)}
                    className={`${styles.button} ${styles.deleteButton}`}
                    simple
                    disabled={migrating}
                    data-tooltip-id={GLOBAL_TOOLTIP_ID}
                    data-tooltip-content="Delete setup"
                  >
                    <i className="fas fa-trash" />
                    <span className="sr-only">Delete setup</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.bannerActions}>
        <Button
          onClick={handleMigrateAll}
          loading={migrating}
          disabled={migrating}
          className={`${styles.button} ${styles.migrateButton}`}
        >
          <i className="fas fa-cloud-arrow-up" />
          Migrate All
        </Button>
        <Button
          onClick={() => setDismissed(true)}
          disabled={migrating}
          className={`${styles.button} ${styles.dismissButton}`}
          simple
        >
          <i className="fas fa-times" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
