'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useContext, useState } from 'react';

import { SetupMetadata, cloneGearSetup } from '@/actions/setup';
import ConfirmationModal from '@/components/confirmation-modal';
import Input from '@/components/input';
import Menu from '@/components/menu';
import { useToast } from '@/components/toast';

import DeleteModal from '../delete-modal';
import { GearSetup } from '../setup';
import { ExportFormat, exportSetup } from '../translate';
import { SetupViewingContext } from '../viewing-context';

import styles from './style.module.scss';

export default function SetupActions({
  showClone = false,
  showDelete = false,
  showEdit = false,
  currentRevision,
  isLatestRevision,
  gearSetup,
  setup,
}: {
  showClone?: boolean;
  showEdit?: boolean;
  showDelete?: boolean;
  currentRevision: number;
  isLatestRevision: boolean;
  gearSetup: GearSetup;
  setup: SetupMetadata;
}) {
  const router = useRouter();
  const showToast = useToast();
  const { highlightedPlayerIndex } = useContext(SetupViewingContext);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneTitle, setCloneTitle] = useState('');
  const [cloning, setCloning] = useState(false);

  const copyShareLink = useCallback(async () => {
    try {
      const url = new URL(`/setups/${setup.publicId}`, window.location.origin);
      if (!isLatestRevision) {
        url.searchParams.set('revision', String(currentRevision));
      }
      if (highlightedPlayerIndex !== null) {
        url.searchParams.set('player', String(highlightedPlayerIndex + 1));
      }
      await navigator.clipboard.writeText(url.toString());
      showToast('Link copied to clipboard', 'success');
    } catch {
      showToast('Failed to copy link', 'error');
    }
  }, [
    currentRevision,
    highlightedPlayerIndex,
    isLatestRevision,
    setup.publicId,
    showToast,
  ]);

  const forkSetup = useCallback(async () => {
    setCloning(true);
    let publicId: string | null = null;
    try {
      const trimmed = cloneTitle.trim();
      const newSetup = await cloneGearSetup(
        gearSetup,
        trimmed.length > 0 ? trimmed : undefined,
      );
      publicId = newSetup.publicId;
    } catch {
      showToast('Failed to clone setup', 'error');
    } finally {
      setCloning(false);
    }

    if (publicId !== null) {
      router.push(`/setups/${publicId}/edit`);
    }
  }, [cloneTitle, gearSetup, router, showToast]);

  const handleExport = useCallback(
    (format: ExportFormat, playerIndex: number) => {
      try {
        const exported = exportSetup(gearSetup, playerIndex, format);
        void navigator.clipboard.writeText(exported);
        showToast(
          `Setup for ${gearSetup.players[playerIndex].name} copied to clipboard`,
        );
      } catch (e) {
        showToast((e as Error).message, 'error');
      }

      setShowExportMenu(false);
    },
    [gearSetup, showToast],
  );

  const exportMenuItems = [
    {
      label: 'Inventory Setups',
      icon: 'fas fa-chevron-right',
      subMenu: gearSetup.players.map((player, index) => ({
        label: player.name,
        customAction: () => handleExport('inventory-setups', index),
      })),
    },
  ];

  const hasPrimaryRow = showEdit || showDelete;

  return (
    <div className={styles.actions}>
      {hasPrimaryRow && (
        <div className={`${styles.actionRow} ${styles.primaryRow}`}>
          {showEdit && (
            <Link
              href={`/setups/${setup.publicId}/edit`}
              className={styles.editButton}
            >
              <i className="fas fa-pencil-alt" />
              <span>Edit</span>
            </Link>
          )}
          {showDelete && (
            <button
              className={`${styles.actionButton} ${styles.deleteButton}`}
              onClick={() => setShowDeleteModal(true)}
            >
              <i className="fas fa-trash" />
              <span>Delete</span>
            </button>
          )}
        </div>
      )}
      <div className={styles.actionRow}>
        {showClone && (
          <button
            className={styles.actionButton}
            onClick={() => {
              setCloneTitle('');
              setCloneModalOpen(true);
            }}
          >
            <i className="fas fa-clone" />
            <span>Clone</span>
          </button>
        )}
        <button
          className={styles.actionButton}
          onClick={() => void copyShareLink()}
        >
          <i className="fas fa-link" />
          <span>Share</span>
        </button>
        <button
          id="setup-export-button"
          className={styles.actionButton}
          onClick={() => setShowExportMenu(true)}
        >
          <i className="fas fa-download" />
          <span>Export…</span>
        </button>
      </div>
      <DeleteModal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onDelete={() => router.replace('/setups/my')}
        setupId={setup.publicId}
      />
      <ConfirmationModal
        open={cloneModalOpen}
        onClose={() => setCloneModalOpen(false)}
        onConfirm={() => void forkSetup()}
        title="Clone setup"
        message={
          <div className={styles.cloneModalBody}>
            <p>
              You&apos;ll be taken to the editor to customize your copy. Give it
              a name or leave blank to use the default.
            </p>
            <Input
              id="clone-setup-title"
              label="Setup title"
              labelBg="var(--blert-surface-dark)"
              value={cloneTitle}
              onChange={(e) => setCloneTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !cloning) {
                  e.preventDefault();
                  void forkSetup();
                }
              }}
              placeholder={`Copy of ${gearSetup.title}`}
              maxLength={128}
              fluid
              autoFocus
            />
          </div>
        }
        confirmText="Clone"
        loading={cloning}
      />
      <Menu
        open={showExportMenu}
        onClose={() => setShowExportMenu(false)}
        width={160}
        targetId="setup-export-button"
        items={exportMenuItems}
      />
    </div>
  );
}
