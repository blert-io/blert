'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { SetupMetadata, cloneGearSetup } from '@/actions/setup';
import Button from '@/components/button';
import { useToast } from '@/components/toast';

import DeleteModal from '../delete-modal';
import { GearSetup } from '../setup';

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

  const forkSetup = useCallback(async () => {
    let publicId: string | null = null;
    try {
      const newSetup = await cloneGearSetup(gearSetup);
      publicId = newSetup.publicId;
    } catch (e) {
      showToast('Failed to clone setup', 'error');
    }

    if (publicId !== null) {
      router.push(`/setups/${publicId}/edit`);
    }
  }, [router, gearSetup, showToast]);

  return (
    <div className={styles.actions}>
      {showEdit && (
        <Link href={`/setups/${setup.publicId}/edit`}>
          <i className="fas fa-pencil-alt" />
          <span>Edit</span>
        </Link>
      )}
      {showDelete && (
        <Button
          className={styles.delete}
          onClick={() => setShowDeleteModal(true)}
        >
          <i className="fas fa-trash" />
          <span style={{ marginLeft: 8 }}>Delete</span>
        </Button>
      )}
      {showClone && (
        <Button onClick={forkSetup}>
          <i className="fas fa-clone" />
          <span style={{ marginLeft: 8 }}>Clone</span>
        </Button>
      )}
      <Button>
        <i className="fas fa-download" />
        <span style={{ marginLeft: 8 }}>Export…</span>
      </Button>
      <DeleteModal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onDelete={() => router.replace('/setups/my')}
        setupId={setup.publicId}
      />
    </div>
  );
}
