'use client';

import { ChallengeType } from '@blert/common';
import { useRouter } from 'next/navigation';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  publishSetupRevision,
  saveSetupDraft,
  type SetupMetadata,
} from '@/actions/setup';
import Button from '@/components/button';
import EditableTextField from '@/components/editable-text-field';
import Item from '@/components/item';
import MarkdownEditor from '@/components/markdown-editor';
import { Modal } from '@/components/modal/modal';
import RadioInput from '@/components/radio-input';
import Tabs from '@/components/tabs';
import { useToast } from '@/components/toast';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { useDisplay, useIsApple, useWidthThreshold } from '@/display';

import DeleteModal from '../../delete-modal';
import {
  EditableGearSetup,
  EditingContext,
  SetupEditingContext,
} from '../../editing-context';
import ItemCounts from '../../item-counts';
import { ItemSelector } from './item-selector';
import PlayerList from '../../player-list';
import { hasAllItems, newGearSetupPlayer } from '../../setup';

import setupStyles from '../../style.module.scss';
import styles from './style.module.scss';

const MAX_PARTY_SIZE = 8;
const MAX_DESCRIPTION_LENGTH = 5000;
const AUTO_SAVE_INTERVAL_MS = 60000;

const MIN_WIDTH_FOR_ITEM_COUNTS_SIDEBAR = 2000;

interface GearSetupsCreatorProps {
  setup: SetupMetadata;
}

function SaveButton({
  disabled,
  onClick,
  modifier,
  hasUnsavedChanges,
}: {
  disabled: boolean;
  onClick: () => void;
  modifier: string;
  hasUnsavedChanges: boolean;
}) {
  const [lastSavedAt, setLastSavedAt] = useState<Date>(new Date());

  useEffect(() => {
    const now = new Date();
    const diffMs = now.getTime() - lastSavedAt.getTime();
    const updateInterval = diffMs < 60000 ? 1000 : 60000;

    const interval = setInterval(() => {
      // Force re-render to update the time display.
      setLastSavedAt(new Date(lastSavedAt.getTime()));
    }, updateInterval);

    return () => clearInterval(interval);
  }, [lastSavedAt]);

  const getSaveTimeText = () => {
    const now = new Date();
    const diffMs = now.getTime() - lastSavedAt.getTime();
    const diffSecs = Math.floor(diffMs / 1000);

    if (diffSecs < 10) {
      return 'Now';
    } else if (diffSecs < 60) {
      return `${diffSecs}s`;
    } else {
      const diffMins = Math.floor(diffSecs / 60);
      if (diffMins < 60) {
        return `${diffMins}m`;
      } else {
        const diffHours = Math.floor(diffMins / 60);
        return `${diffHours}h`;
      }
    }
  };

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      data-tooltip-id={GLOBAL_TOOLTIP_ID}
      data-tooltip-content={`Save (${modifier}+S)`}
      className={styles.saveWithTime}
    >
      {hasUnsavedChanges && <span className={styles.unsavedDot} />}
      <i className="fas fa-save" />
      <span className={styles.saveTime}>{getSaveTimeText()}</span>
      <span className="sr-only">Save</span>
    </button>
  );
}

export default function GearSetupsCreator({ setup }: GearSetupsCreatorProps) {
  const router = useRouter();
  const showToast = useToast();

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);
  const [itemPanelOpen, setItemPanelOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [saveCompleteCounter, setSaveCompleteCounter] = useState(0);

  const display = useDisplay();
  const itemCountsAsSidebar = useWidthThreshold(
    MIN_WIDTH_FOR_ITEM_COUNTS_SIDEBAR,
  );
  const isApple = useIsApple();

  const itemPanelContentHeight =
    (typeof window !== 'undefined' ? window.innerHeight : 0) * 0.9 - 40;

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

  const context = useMemo(
    () => new EditingContext(setup.publicId, editableSetup, setEditableSetup),
    [editableSetup, setup.publicId, setEditableSetup],
  );
  const gearSetup = context.setup;

  const onDescriptionChange = useCallback(
    (description: string) => {
      context.update((prev) => ({ ...prev, description }));
    },
    [context],
  );

  const handleSave = useCallback(
    async (isAutoSave: boolean = false) => {
      if (!context.modified || saving) {
        return;
      }

      try {
        setSaving(true);
        await saveSetupDraft(setup.publicId, context.setup);
        context.clearModified();
        setSaveCompleteCounter((c) => c + 1);
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
    },
    [setup.publicId, context, saving, showToast],
  );

  const handlePublish = useCallback(
    async (publishMessage: string) => {
      try {
        setPublishLoading(true);
        await publishSetupRevision(
          setup.publicId,
          gearSetup,
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
    },
    [gearSetup, router, setup.publicId, showToast],
  );

  useEffect(() => {
    if (!editableSetup.modified) {
      return undefined;
    }

    const timer = setTimeout(() => {
      handleSave(true);
    }, AUTO_SAVE_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [editableSetup.modified, handleSave]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      if (inInput) {
        if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          handleSave(false);
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          context.setSelectedItem(null);
          break;

        case '?':
          e.preventDefault();
          setShowShortcutsModal(true);
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

  const itemCounts = (
    <ItemCounts
      setup={context.setup}
      selectedItemId={context.selectedItem?.id}
    />
  );

  const modifier = isApple ? '⌘' : 'Ctrl';

  return (
    <SetupEditingContext.Provider value={context}>
      <div className={styles.creator}>
        <div className={styles.actions}>
          <div className={styles.editing}>
            <button
              disabled={editableSetup.position === 0}
              onClick={() => context.undo()}
              data-tooltip-id={GLOBAL_TOOLTIP_ID}
              data-tooltip-content={`Undo (${modifier}+Z)`}
            >
              <i className="fas fa-undo" />
              <span className="sr-only">Undo</span>
            </button>
            <button
              disabled={
                editableSetup.position === editableSetup.history.length - 1
              }
              onClick={() => context.redo()}
              data-tooltip-id={GLOBAL_TOOLTIP_ID}
              data-tooltip-content={`Redo (${modifier}+Y)`}
            >
              <i className="fas fa-redo" />
              <span className="sr-only">Redo</span>
            </button>
            <SaveButton
              disabled={!editableSetup.modified || saving}
              onClick={() => handleSave(false)}
              modifier={modifier}
              hasUnsavedChanges={editableSetup.modified}
              key={saveCompleteCounter}
            />
            <button
              onClick={() => setShowShortcutsModal(true)}
              data-tooltip-id={GLOBAL_TOOLTIP_ID}
              data-tooltip-content="Keyboard shortcuts (?)"
            >
              <i className="fas fa-question-circle" />
              <span className="sr-only">Keyboard shortcuts</span>
            </button>
          </div>
          <div className={styles.publishing}>
            <Button
              className={`${styles.button} ${styles.delete}`}
              disabled={publishing || publishLoading}
              onClick={() => setShowDeleteModal(true)}
              data-tooltip-id={GLOBAL_TOOLTIP_ID}
              data-tooltip-content="Delete setup"
            >
              <i className="fas fa-trash" />
              Delete
            </Button>
            <Button
              className={styles.button}
              disabled={publishing || publishLoading}
              loading={publishLoading}
              onClick={() => setPublishing(true)}
              data-tooltip-id={GLOBAL_TOOLTIP_ID}
              data-tooltip-content="Publish setup"
            >
              <i className="fas fa-upload" />
              Publish
            </Button>
          </div>
        </div>
        {itemCountsAsSidebar && (
          <div className={styles.itemCountsSidebar}>{itemCounts}</div>
        )}
        <div className={styles.main}>
          <div className={`${setupStyles.panel} ${styles.overview}`}>
            <EditableTextField
              className={styles.title}
              value={context.setup.title}
              onChange={(title) =>
                context.update((prev) => ({ ...prev, title }))
              }
              tag="h1"
              width="95%"
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
                    label="Inferno"
                    value={ChallengeType.INFERNO}
                  />
                  <RadioInput.Option
                    checked={
                      context.setup.challenge === ChallengeType.COLOSSEUM
                    }
                    id={`setup-challenge-type-${ChallengeType.COLOSSEUM}`}
                    label={display.isCompact() ? 'Colo' : 'Colosseum'}
                    value={ChallengeType.COLOSSEUM}
                  />
                </RadioInput.Group>
              </div>
            </div>
            <div className={styles.descriptionWrapper}>
              <label className={styles.label}>Description</label>
              <MarkdownEditor
                value={context.setup.description}
                onChange={onDescriptionChange}
                placeholder="Describe your gear setup"
                maxLength={MAX_DESCRIPTION_LENGTH}
              />
            </div>
          </div>
          {!display.isCompact() && !itemCountsAsSidebar && itemCounts}
          <PlayerList
            className={styles.players}
            players={context.setup.players}
            onAddPlayer={() => {
              context.update((prev) => {
                if (prev.players.length >= MAX_PARTY_SIZE) {
                  return prev;
                }
                const newPlayer = newGearSetupPlayer(prev.players.length + 1);
                return {
                  ...prev,
                  players: [...prev.players, newPlayer],
                };
              });
            }}
            showAddButton={context.setup.players.length < MAX_PARTY_SIZE}
          />
        </div>
        {!display.isCompact() && (
          <div className={styles.selector}>
            <ItemSelector />
          </div>
        )}
        {display.isCompact() && (
          <>
            {context.selectedItem && (
              <button
                className={styles.selectedItemOverlay}
                onClick={() => context.setSelectedItem(null)}
              >
                <Item
                  id={context.selectedItem.id}
                  name={context.selectedItem.name}
                  quantity={1}
                  size={32}
                />
                <span className="sr-only">
                  Unselect item: {context.selectedItem.name}
                </span>
                <i className="fas fa-times" />
              </button>
            )}
            {itemPanelOpen && (
              <div
                className={styles.panelBackground}
                onClick={() => setItemPanelOpen(false)}
              />
            )}
            <div
              className={`${styles.itemPanel} ${itemPanelOpen ? styles.open : ''}`}
            >
              <button
                className={styles.toggle}
                onClick={() => setItemPanelOpen((prev) => !prev)}
              >
                <i
                  className={`fas fa-chevron-${itemPanelOpen ? 'down' : 'up'}`}
                />
                Items
              </button>
              <Tabs
                fluid
                maxHeight={itemPanelContentHeight}
                small
                tabs={[
                  {
                    icon: 'fas fa-cog',
                    title: 'Item selector',
                    content: <ItemSelector />,
                  },
                  {
                    icon: 'fas fa-list',
                    title: 'Item counts',
                    content: itemCounts,
                  },
                ]}
              />
            </div>
          </>
        )}
      </div>
      <PublishModal
        setup={setup}
        open={publishing}
        onClose={() => setPublishing(false)}
        onPublish={handlePublish}
        publishIssues={publishIssues}
        publishLoading={publishLoading}
      />
      <DeleteModal
        setupId={setup.publicId}
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onDelete={() => router.replace('/setups/my')}
      />
      <KeyboardShortcutsModal
        open={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />
    </SetupEditingContext.Provider>
  );
}

function PublishModal({
  setup,
  open,
  onClose,
  onPublish,
  publishIssues,
  publishLoading,
}: {
  setup: SetupMetadata;
  open: boolean;
  onClose: () => void;
  onPublish: (message: string) => void;
  publishIssues: Array<{ message: string; type: 'warning' | 'error' }>;
  publishLoading: boolean;
}) {
  const [publishMessage, setPublishMessage] = useState('');

  return (
    <Modal className={styles.publishModal} open={open} onClose={onClose}>
      <div className={styles.modalHeader}>
        <h2>Publish setup</h2>
        <button onClick={onClose}>
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
          <Button onClick={onClose} simple>
            Cancel
          </Button>
          <Button
            disabled={publishIssues.some((w) => w.type === 'error')}
            loading={publishLoading}
            onClick={() => onPublish(publishMessage)}
          >
            Publish
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function KeyboardShortcutsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const isApple = useIsApple();
  const modifier = isApple ? '⌘' : 'Ctrl';

  const shortcuts = [
    {
      category: 'Editing',
      items: [
        { keys: [`${modifier}+Z`], description: 'Undo' },
        { keys: [`${modifier}+Y`], description: 'Redo' },
        { keys: [`${modifier}+S`], description: 'Save setup' },
        { keys: ['?'], description: 'Show keyboard shortcuts' },
      ],
    },
    {
      category: 'Item Management',
      items: [
        { keys: ['/'], description: 'Focus item search' },
        { keys: ['Esc'], description: 'Clear selected item / Close search' },
        { keys: [`${modifier}+Click`], description: 'Select item from slot' },
      ],
    },
    {
      category: 'Slot Actions',
      items: [
        { keys: ['Click (empty slot)'], description: 'Open item search' },
        {
          keys: ['Click (filled slot)'],
          description: 'Remove item (no item selected)',
        },
        { keys: ['Click (filled slot)'], description: 'Place selected item' },
      ],
    },
  ];

  return (
    <Modal className={styles.shortcutsModal} open={open} onClose={onClose}>
      <div className={styles.modalHeader}>
        <h2>Keyboard Shortcuts</h2>
        <button onClick={onClose}>
          <i className="fas fa-times" />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className={styles.shortcutsContent}>
        {shortcuts.map((category) => (
          <div key={category.category} className={styles.shortcutCategory}>
            <h3>{category.category}</h3>
            <div className={styles.shortcutList}>
              {category.items.map((shortcut, idx) => (
                <div key={idx} className={styles.shortcutItem}>
                  <div className={styles.keys}>
                    {shortcut.keys.map((key, keyIdx) => (
                      <kbd key={keyIdx} className={styles.key}>
                        {key}
                      </kbd>
                    ))}
                  </div>
                  <span className={styles.description}>
                    {shortcut.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
