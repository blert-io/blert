'use client';

import { ChallengeType, challengeName } from '@blert/common';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  publishSetupRevision,
  saveSetupDraft,
  type SetupMetadata,
} from '@/actions/setup';
import Button from '@/components/button';
import EditableTextField from '@/components/editable-text-field';
import { Modal } from '@/components/modal/modal';
import RadioInput from '@/components/radio-input';
import { useToast } from '@/components/toast';

import {
  EditableGearSetup,
  EditingContext,
  SetupEditingContext,
} from '../../editing-context';
import { Player } from '../../player';
import { hasAllItems, newGearSetupPlayer } from '../../setup';
import { ItemSelector } from './item-selector';

import setupStyles from '../../style.module.scss';
import styles from './style.module.scss';

const OVERVIEW_WIDTH = 900;

const MAX_PARTY_SIZE = 8;
const AUTO_SAVE_INTERVAL_MS = 60000;

interface GearSetupsCreatorProps {
  setup: SetupMetadata;
}

export default function GearSetupsCreator({ setup }: GearSetupsCreatorProps) {
  const router = useRouter();
  const showToast = useToast();

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState('');
  const [publishLoading, setPublishLoading] = useState(false);

  const [editableSetup, setEditableSetup] = useState<EditableGearSetup>(
    EditingContext.newEditableGearSetup(
      setup.draft ?? {
        title: setup.name,
        description: 'My new gear setup',
        challenge: setup.challengeType,
        players: [newGearSetupPlayer(1)],
      },
    ),
  );

  const context = new EditingContext(
    setup.publicId,
    editableSetup,
    setEditableSetup,
  );

  const handleSave = async (isAutoSave: boolean = false) => {
    if (!context.modified || saving) {
      return;
    }

    try {
      setSaving(true);
      await saveSetupDraft(setup.publicId, context.setup);
      context.clearModified();
      if (isAutoSave) {
        showToast('Auto-saved setup');
      } else {
        showToast('Saved setup');
      }
    } catch (e) {
      showToast('Failed to save setup');
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = useCallback(async () => {
    try {
      setPublishLoading(true);
      await publishSetupRevision(
        setup.publicId,
        context.setup,
        publishMessage || null,
      );

      showToast('Published setup');

      setTimeout(() => {
        router.push(`/setups/${setup.publicId}`);
      }, 100);
    } catch (e) {
      showToast('Failed to publish setup');
    } finally {
      setPublishLoading(false);
      setPublishing(false);
    }
  }, [context, publishMessage, router, setup.publicId, showToast]);

  useEffect(() => {
    if (!editableSetup.modified) {
      return undefined;
    }

    const timer = setTimeout(() => {
      handleSave(true);
    }, AUTO_SAVE_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [context, editableSetup.modified, showToast]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      if (inInput) {
        return;
      }

      switch (e.key) {
        case 'Escape':
          context.setSelectedItem(null);
          break;

        case 's':
          if (e.ctrlKey) {
            e.preventDefault();
            handleSave(false);
          }
          break;
        case 'y':
          if (e.ctrlKey) {
            context.redo();
          }
          break;
        case 'z':
          if (e.ctrlKey) {
            context.undo();
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [context, handleSave]);

  const publishIssues: Array<{ message: string; type: 'warning' | 'error' }> =
    [];
  if (publishing) {
    if (context.setup.title.length === 0) {
      publishIssues.push({
        message: 'Setup must have a title.',
        type: 'error',
      });
    }
    if (context.setup.description.length === 0) {
      publishIssues.push({
        message: 'Setup must have a description.',
        type: 'error',
      });
    }
    if (!hasAllItems(context.setup)) {
      publishIssues.push({
        message:
          'Not all item slots are filled. Check your setup for missing items.',
        type: 'warning',
      });
    }
  }

  return (
    <SetupEditingContext.Provider value={context}>
      <div className={styles.creator}>
        <div className={styles.actions}>
          <div className={styles.editing}>
            <button
              disabled={editableSetup.position === 0}
              onClick={() => context.undo()}
            >
              <i className="fas fa-undo" />
              <span className="sr-only">Undo</span>
            </button>
            <button
              disabled={
                editableSetup.position === editableSetup.history.length - 1
              }
              onClick={() => context.redo()}
            >
              <i className="fas fa-redo" />
              <span className="sr-only">Redo</span>
            </button>
            <button
              disabled={!editableSetup.modified || saving}
              onClick={() => handleSave(false)}
            >
              <i className="fas fa-save" />
              <span className="sr-only">Save</span>
            </button>
          </div>
          <div className={styles.publishing}>
            <Button
              className={styles.button}
              loading={publishLoading}
              onClick={() => setPublishing(true)}
            >
              Publish
            </Button>
          </div>
        </div>
        <div className={styles.main}>
          <div className={`${setupStyles.panel} ${styles.overview}`}>
            <EditableTextField
              className={styles.title}
              value={context.setup.title}
              onChange={(title) =>
                context.update((prev) => ({ ...prev, title }))
              }
              tag="h1"
              width={OVERVIEW_WIDTH}
            />
            <div className={styles.group}>
              <div className={styles.challengeType}>
                <label className={styles.label}>Challenge type</label>
                <RadioInput.Group
                  name="setup-challenge-type"
                  onChange={(value) =>
                    context.update((prev) => ({
                      ...prev,
                      challenge: value as ChallengeType,
                    }))
                  }
                >
                  <RadioInput.Option
                    checked={context.setup.challenge === ChallengeType.TOB}
                    id={`setup-challenge-type-${ChallengeType.TOB}`}
                    label="ToB"
                    value={ChallengeType.TOB}
                  />
                  <RadioInput.Option
                    checked={context.setup.challenge === ChallengeType.COX}
                    id={`setup-challenge-type-${ChallengeType.COX}`}
                    label="CoX"
                    value={ChallengeType.COX}
                  />
                  <RadioInput.Option
                    checked={context.setup.challenge === ChallengeType.TOA}
                    id={`setup-challenge-type-${ChallengeType.TOA}`}
                    label="ToA"
                    value={ChallengeType.TOA}
                  />
                  <RadioInput.Option
                    checked={context.setup.challenge === ChallengeType.INFERNO}
                    id={`setup-challenge-type-${ChallengeType.INFERNO}`}
                    label={challengeName(ChallengeType.INFERNO)}
                    value={ChallengeType.INFERNO}
                  />
                  <RadioInput.Option
                    checked={
                      context.setup.challenge === ChallengeType.COLOSSEUM
                    }
                    id={`setup-challenge-type-${ChallengeType.COLOSSEUM}`}
                    label={challengeName(ChallengeType.COLOSSEUM)}
                    value={ChallengeType.COLOSSEUM}
                  />
                </RadioInput.Group>
              </div>
            </div>
            <div>
              <label className={styles.label}>Description</label>
              <EditableTextField
                className={styles.description}
                onChange={(description) =>
                  context.update((prev) => ({ ...prev, description }))
                }
                inputTag="textarea"
                tag="p"
                value={context.setup.description}
                width={OVERVIEW_WIDTH}
              />
            </div>
          </div>
          <div className={`${setupStyles.panel} ${setupStyles.players}`}>
            {context.setup.players.map((player, i) => (
              <Player key={i} index={i} player={player} />
            ))}
            {context.setup.players.length < MAX_PARTY_SIZE && (
              <div className={styles.addPlayer}>
                <button
                  onClick={() =>
                    context.update((prev) => {
                      if (prev.players.length >= MAX_PARTY_SIZE) {
                        return prev;
                      }
                      const newPlayer = newGearSetupPlayer(
                        prev.players.length + 1,
                      );
                      return { ...prev, players: [...prev.players, newPlayer] };
                    })
                  }
                >
                  <i className="fas fa-plus" />
                  <span>Add</span>
                </button>
              </div>
            )}
          </div>
        </div>
        <div className={styles.selector}>
          <ItemSelector />
        </div>
      </div>

      <Modal
        className={styles.publishModal}
        open={publishing}
        onClose={() => setPublishing(false)}
      >
        <div className={styles.modalHeader}>
          <h2>Publish setup</h2>
          <button onClick={() => setPublishing(false)}>
            <i className="fas fa-times" />
            <span className="sr-only">Close</span>
          </button>
        </div>
        <div className={styles.publishDialog}>
          {setup.latestRevision === null ? (
            <p>
              Publishing will make your setup visible to other users. You can
              still make changes after publishing by creating new revisions.
            </p>
          ) : (
            <p>
              Publishing will create a new revision (v
              {setup.latestRevision.version + 1}) of your setup. Previous
              revisions will be preserved and can be viewed in the revision
              history.
            </p>
          )}
          {publishIssues.length > 0 && (
            <div className={styles.issues}>
              <p>Issues have been detected with your setup:</p>
              <ul>
                {publishIssues.map((issue) => (
                  <li
                    key={issue.message}
                    className={`${styles.issue} ${styles[issue.type]}`}
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className={styles.field}>
            <label htmlFor="publish-message">Revision message (optional)</label>
            <textarea
              id="publish-message"
              value={publishMessage}
              onChange={(e) => setPublishMessage(e.target.value)}
              placeholder="Describe your changes..."
              rows={3}
            />
          </div>
          <div className={styles.actions}>
            <Button onClick={() => setPublishing(false)} simple>
              Cancel
            </Button>
            <Button
              disabled={publishIssues.some((w) => w.type === 'error')}
              loading={publishLoading}
              onClick={handlePublish}
            >
              Publish
            </Button>
          </div>
        </div>
      </Modal>
    </SetupEditingContext.Provider>
  );
}
