'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { SetupMetadata, cloneGearSetup } from '@/actions/setup';
import Menu from '@/components/menu';
import { useToast } from '@/components/toast';

import DeleteModal from '../delete-modal';
import { GearSetup } from '../setup';
import { ExportFormat, exportSetup } from '../translate';

import styles from './style.module.scss';

export default function SetupActions({
  showClone = false,
  showDelete = false,
  showEdit = false,
  gearSetup,
  setup,
}: {
  showClone?: boolean;
  showEdit?: boolean;
  showDelete?: boolean;
  gearSetup: GearSetup;
  setup: SetupMetadata;
}) {
  const router = useRouter();
  const showToast = useToast();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const forkSetup = useCallback(async () => {
    let publicId: string | null = null;
    try {
      const newSetup = await cloneGearSetup(gearSetup);
      publicId = newSetup.publicId;
    } catch {
      showToast('Failed to clone setup', 'error');
    }

    if (publicId !== null) {
      router.push(`/setups/${publicId}/edit`);
    }
  }, [router, gearSetup, showToast]);

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

  return (
    <div className={styles.actions}>
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
      {showClone && (
        <button
          className={styles.actionButton}
          onClick={() => void forkSetup()}
        >
          <i className="fas fa-clone" />
          <span>Clone</span>
        </button>
      )}
      <button
        id="setup-export-button"
        className={styles.actionButton}
        onClick={() => setShowExportMenu(true)}
      >
        <i className="fas fa-download" />
        <span>Export…</span>
      </button>
      <DeleteModal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onDelete={() => router.replace('/setups/my')}
        setupId={setup.publicId}
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
