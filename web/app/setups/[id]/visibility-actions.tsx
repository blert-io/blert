'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { updateSetupVisibility } from '@/actions/setup';
import ConfirmationModal from '@/components/confirmation-modal';
import { useToast } from '@/components/toast';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';

import styles from './style.module.scss';

type Props = {
  publicId: string;
  currentState: 'published' | 'unlisted';
};

export function VisibilityToggleButton({ publicId, currentState }: Props) {
  const router = useRouter();
  const showToast = useToast();
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const nextState = currentState === 'unlisted' ? 'published' : 'unlisted';

  const confirm = useCallback(async () => {
    setLoading(true);
    try {
      const updated = await updateSetupVisibility(publicId, nextState);
      if (updated === null) {
        showToast('Failed to update visibility', 'error');
        return;
      }
      showToast(
        nextState === 'published'
          ? 'Setup is now published'
          : 'Setup is now unlisted',
        'success',
      );
      setConfirmOpen(false);
      router.refresh();
    } catch {
      showToast('Failed to update visibility', 'error');
    } finally {
      setLoading(false);
    }
  }, [nextState, publicId, router, showToast]);

  const trigger =
    currentState === 'unlisted' ? (
      <button
        type="button"
        className={styles.unlistedBannerAction}
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
      >
        <i className="fas fa-globe" />
        Make public
      </button>
    ) : (
      <button
        type="button"
        className={styles.visibilityChip}
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
        data-tooltip-id={GLOBAL_TOOLTIP_ID}
        data-tooltip-content="Click to unlist this setup"
      >
        <i className="fas fa-globe" />
        Public
        <span className={styles.chipDivider} />
        <span className={styles.chipAction}>Unlist</span>
      </button>
    );

  return (
    <>
      {trigger}
      <ConfirmationModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void confirm()}
        title={
          nextState === 'unlisted'
            ? 'Unlist this setup?'
            : 'Publish this setup?'
        }
        message={
          nextState === 'unlisted'
            ? 'The setup will be hidden from the community feed, search results, and public listings. People with the direct link can still view it.'
            : 'The setup will be listed in the community feed and indexed by search engines. Anyone will be able to discover and view it.'
        }
        confirmText={nextState === 'unlisted' ? 'Unlist' : 'Publish'}
        loading={loading}
      />
    </>
  );
}
