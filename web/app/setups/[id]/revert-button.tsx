'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { saveSetupDraft } from '@/actions/setup';
import ConfirmationModal from '@/components/confirmation-modal';
import { useToast } from '@/components/toast';

import { GearSetup } from '../setup';

import styles from './style.module.scss';

type Props = {
  publicId: string;
  gearSetup: GearSetup;
  currentRevision: number;
};

export function RevertButton({ publicId, gearSetup, currentRevision }: Props) {
  const router = useRouter();
  const showToast = useToast();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const confirm = useCallback(async () => {
    setLoading(true);
    try {
      await saveSetupDraft(publicId, gearSetup);
      router.push(`/setups/${publicId}/edit`);
    } catch {
      showToast('Failed to revert setup', 'error');
      setLoading(false);
    }
  }, [gearSetup, publicId, router, showToast]);

  return (
    <>
      <button
        type="button"
        className={styles.revisionBannerAction}
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
      >
        <i className="fas fa-undo" />
        Revert to this revision
      </button>
      <ConfirmationModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void confirm()}
        title={`Revert to v${currentRevision}?`}
        message={
          <>
            This will load v{currentRevision} into the editor as a new draft,
            replacing any in-progress draft you have. You&apos;ll need to
            publish to create a new revision.
          </>
        }
        confirmText="Revert"
        loading={loading}
      />
    </>
  );
}
