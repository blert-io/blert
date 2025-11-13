'use client';

import { challengeName, ChallengeType } from '@blert/common';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

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

import { slotIdFromString } from '../../container-grid';
import { ContextMenuWrapper } from './context-menu';
import DeleteModal from '../../delete-modal';
import DebugOverlay from './debug-overlay';
import {
  EditableGearSetup,
  EditingContext,
  OperationMode,
  SetupEditingContext,
} from '../../editing-context';
import ItemCounts from '../../item-counts';
import { setupLocalStorage } from '../../local-storage';
import { ItemSelector } from './item-selector';
import PlayerList from '../../player-list';
import { GearSetup, hasAllItems, newGearSetupPlayer } from '../../setup';

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

        if (context.isLocal) {
          setupLocalStorage.saveSetup(setup.publicId, context.setup);
        } else {
          await saveSetupDraft(setup.publicId, context.setup);
        }
        context.clearModified();
        setSaveCompleteCounter((c) => c + 1);
        if (isAutoSave) {
          showToast('Auto-saved setup');
        } else {
          showToast('Saved setup');
        }
      } catch (e) {
        showToast('Failed to save setup', 'error');
      } finally {
        setSaving(false);
      }
    },
    [setup.publicId, context, saving, showToast],
  );

  const isLocal = context.isLocal;

  const handlePublish = useCallback(
    async (publishMessage: string) => {
      try {
        if (isLocal) {
          // This should not be called by the publish modal.
          return;
        }

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
    [gearSetup, router, setup.publicId, showToast, isLocal],
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
          if (
            context.operationMode === OperationMode.CLIPBOARD_CUT ||
            context.operationMode === OperationMode.CLIPBOARD_COPY
          ) {
            context.setOperationMode(OperationMode.SELECTION);
          } else if (context.selection !== null) {
            context.clearSelection();
          } else {
            context.setSelectedItem(null);
          }
          break;

        case 'Delete':
          if (context.selection !== null) {
            e.preventDefault();
            context.deleteSelection();
          }
          break;

        case '?':
          e.preventDefault();
          setShowShortcutsModal(true);
          break;

        case 'a':
          if (e.ctrlKey || e.metaKey) {
            const selectItemsOnly = e.shiftKey;
            if (context.selection !== null) {
              e.preventDefault();
              const { container, playerIndex } = context.selection.bounds;
              context.selectAll(container, playerIndex, selectItemsOnly);
            } else if (context.activeSearchSlot !== null) {
              e.preventDefault();
              const slotId = slotIdFromString(context.activeSearchSlot);
              if (slotId !== null) {
                context.selectAll(
                  slotId.container,
                  slotId.playerIndex,
                  selectItemsOnly,
                );
              }
            }
          }
          break;

        case 'c':
          if (e.ctrlKey || e.metaKey) {
            if (context.selection !== null) {
              e.preventDefault();
              context.copySelection();
            }
          }
          break;

        case 's':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleSave(false);
          }
          break;

        case 'v':
          if (context.clipboard !== null) {
            e.preventDefault();
            context.cycleClipboardMode();
          }
          break;

        case 'x':
          if (e.ctrlKey || e.metaKey) {
            if (context.selection !== null) {
              e.preventDefault();
              context.cutSelection();
            }
          }
          break;

        case 'y':
          if (e.ctrlKey || e.metaKey) {
            context.redo();
          }
          break;

        case 'z':
          if (e.ctrlKey || e.metaKey) {
            context.undo();
          }
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [context, handleSave]);

  useEffect(() => {
    if (!context.isPlacementMode) {
      return;
    }

    const handlePlacementRelease = (e: MouseEvent) => {
      const { placementHoverTarget } = context;

      if (context.operationMode === OperationMode.DRAGGING) {
        if (placementHoverTarget !== null) {
          e.preventDefault();
          context.completeDrag(
            placementHoverTarget.container,
            placementHoverTarget.playerIndex,
            placementHoverTarget.gridCoords,
          );
        } else {
          context.cancelDrag();
        }
      } else if (
        context.operationMode === OperationMode.CLIPBOARD_CUT ||
        context.operationMode === OperationMode.CLIPBOARD_COPY
      ) {
        // Paste completion is done by slots. Only handle the reset case here.
        if (placementHoverTarget === null) {
          context.setOperationMode(OperationMode.SELECTION);
        }
      }
    };

    // Drag release happens on mouseup, clipboard release happens on click.
    const eventType =
      context.operationMode === OperationMode.DRAGGING ? 'mouseup' : 'click';
    window.addEventListener(eventType, handlePlacementRelease);
    return () => window.removeEventListener(eventType, handlePlacementRelease);
  }, [context]);

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

  const topOffset = context.isLocal
    ? 'var(--actions-height) + var(--anonymous-banner-height)'
    : 'var(--actions-height)';

  return (
    <SetupEditingContext.Provider value={context}>
      <ContextMenuWrapper>
        <div
          className={styles.creator}
          style={{
            ['--top-offset' as string]: topOffset,
          }}
        >
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
          {context.isLocal && (
            <div className={styles.anonymousBanner}>
              <div className={styles.anonymousBannerContent}>
                <i className="fas fa-info-circle" />
                <span>
                  You&apos;re editing a local setup.{' '}
                  <Link href="/register?next=/setups/my">Sign up</Link> to
                  publish and share it.
                </span>
              </div>
            </div>
          )}
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
                      checked={
                        context.setup.challenge === ChallengeType.INFERNO
                      }
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
      </ContextMenuWrapper>
      <PublishModal
        setup={setup}
        gearSetup={context.setup}
        isLocal={context.isLocal}
        open={publishing}
        onClose={() => setPublishing(false)}
        onPublish={handlePublish}
        publishIssues={publishIssues}
        publishLoading={publishLoading}
      />
      <DeleteModal
        setupId={setup.publicId}
        isLocal={context.isLocal}
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onDelete={() =>
          router.replace(context.isLocal ? '/setups' : '/setups/my')
        }
      />
      <KeyboardShortcutsModal
        open={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />
      {process.env.NODE_ENV === 'development' && <DebugOverlay />}
    </SetupEditingContext.Provider>
  );
}

function PublishModal({
  setup,
  gearSetup,
  isLocal,
  open,
  onClose,
  onPublish,
  publishIssues,
  publishLoading,
}: {
  setup: SetupMetadata;
  gearSetup: GearSetup;
  isLocal: boolean;
  open: boolean;
  onClose: () => void;
  onPublish: (message: string) => void;
  publishIssues: Array<{ message: string; type: 'warning' | 'error' }>;
  publishLoading: boolean;
}) {
  const router = useRouter();
  const [publishMessage, setPublishMessage] = useState('');

  const migrationUrl = `/setups/my?migrate=${setup.publicId}`;

  let content;
  if (isLocal) {
    content = (
      <div className={styles.publishDialog}>
        <div className={styles.localNotice}>
          <div className={styles.noticeIcon}>
            <i className="fas fa-hard-drive" />
          </div>
          <div className={styles.noticeContent}>
            <h3>You&apos;re editing a local setup</h3>
            <p>
              Your setup is currently stored locally in your browser. To publish
              and share it with the community, you&apos;ll need to create a free
              account.
            </p>
          </div>
        </div>

        <div className={styles.benefits}>
          <h4>What you&apos;ll get with an account:</h4>
          <ul>
            <li>
              <i className="fas fa-share-nodes" />
              <div>
                <strong>Publish & Share</strong>
                <span>Make your setup visible to the community</span>
              </div>
            </li>
            <li>
              <i className="fas fa-cloud" />
              <div>
                <strong>Cloud Backup</strong>
                <span>Never lose your work, access from anywhere</span>
              </div>
            </li>
            <li>
              <i className="fas fa-infinity" />
              <div>
                <strong>Unlimited Setups</strong>
                <span>No more 5-setup limit</span>
              </div>
            </li>
            <li>
              <i className="fas fa-code-branch" />
              <div>
                <strong>Revision History</strong>
                <span>Track changes and manage versions</span>
              </div>
            </li>
          </ul>
        </div>

        <div className={styles.setupPreview}>
          <div className={styles.previewLabel}>Setup to be published:</div>
          <div className={styles.previewCard}>
            <div className={styles.previewIcon}>
              <i className="fas fa-shield" />
            </div>
            <div className={styles.previewInfo}>
              <span className={styles.previewName}>{gearSetup.title}</span>
              <div className={styles.previewMeta}>
                <span>
                  <i className="fas fa-shield" />
                  {challengeName(gearSetup.challenge)}
                </span>
                <span>
                  <i className="fas fa-users" />
                  {gearSetup.players.length} player
                  {gearSetup.players.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <Button onClick={onClose} simple>
            <i className="fas fa-arrow-left" />
            Back to Editing
          </Button>
          <Button
            onClick={() =>
              router.push(`/register?next=${encodeURIComponent(migrationUrl)}`)
            }
            className={styles.signupButton}
          >
            <i className="fas fa-user-plus" />
            Create Free Account
          </Button>
        </div>

        <div className={styles.signInPrompt}>
          Already have an account?{' '}
          <Link href={`/login?next=${encodeURIComponent(migrationUrl)}`}>
            Sign in
          </Link>
        </div>
      </div>
    );
  } else {
    content = (
      <div className={styles.publishDialog}>
        <div className={styles.publishInfo}>
          {setup.latestRevision === null ? (
            <>
              <div className={styles.infoIcon}>
                <i className="fas fa-rocket" />
              </div>
              <div className={styles.infoContent}>
                <h3>Ready to Publish</h3>
                <p>
                  Your setup will be published to the community where others can
                  view, vote on, and use it. You can still make changes after
                  publishing by creating new revisions.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className={styles.infoIcon}>
                <i className="fas fa-code-branch" />
              </div>
              <div className={styles.infoContent}>
                <h3>New Revision</h3>
                <p>
                  This will create{' '}
                  <strong>version {setup.latestRevision.version + 1}</strong> of
                  your setup. Previous revisions remain accessible and can be
                  viewed in the revision history.
                </p>
              </div>
            </>
          )}
        </div>

        {publishIssues.length > 0 && (
          <div className={styles.issues}>
            <div className={styles.issuesHeader}>
              <i className="fas fa-triangle-exclamation" />
              <span>Issues Detected</span>
            </div>
            <ul>
              {publishIssues.map((issue, index) => (
                <li
                  key={index}
                  className={`${styles.issue} ${styles[issue.type]}`}
                >
                  <i
                    className={`fas fa-${issue.type === 'error' ? 'circle-xmark' : 'circle-exclamation'}`}
                  />
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className={styles.field}>
          <label htmlFor="publish-message">
            <i className="fas fa-message" />
            Revision message <span className={styles.optional}>(optional)</span>
          </label>
          <textarea
            id="publish-message"
            value={publishMessage}
            onChange={(e) => setPublishMessage(e.target.value)}
            placeholder={
              setup.latestRevision === null
                ? 'Initial version'
                : 'Describe what changed in this version...'
            }
            rows={3}
            maxLength={500}
          />
          <div className={styles.characterCount}>
            {publishMessage.length}/500
          </div>
        </div>

        <div className={styles.actions}>
          <Button onClick={onClose} simple>
            Cancel
          </Button>
          <Button
            disabled={publishIssues.some((w) => w.type === 'error')}
            loading={publishLoading}
            onClick={() => onPublish(publishMessage)}
            className={styles.publishButton}
          >
            <i className="fas fa-upload" />
            {setup.latestRevision === null
              ? 'Publish Setup'
              : 'Publish Revision'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Modal className={styles.publishModal} open={open} onClose={onClose}>
      <div className={styles.modalHeader}>
        <h2>
          <i className="fas fa-upload" />
          {isLocal
            ? 'Publish Setup'
            : setup.latestRevision === null
              ? 'Publish Setup'
              : 'Publish New Revision'}
        </h2>
        <button onClick={onClose}>
          <i className="fas fa-times" />
          <span className="sr-only">Close</span>
        </button>
      </div>
      {content}
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
  const ctrl = isApple ? '⌘' : 'Ctrl';
  const alt = isApple ? '⌥' : 'Alt';

  const shortcuts = [
    {
      category: 'Editing',
      items: [
        { keys: [`${ctrl}+Z`], description: 'Undo' },
        { keys: [`${ctrl}+Y`], description: 'Redo' },
        { keys: [`${ctrl}+S`], description: 'Save setup draft' },
        { keys: ['?'], description: 'Show keyboard shortcuts' },
      ],
    },
    {
      category: 'Selection',
      items: [
        { keys: ['Click+Drag'], description: 'Select region' },
        { keys: ['Shift+Drag'], description: 'Force selection' },
        { keys: [`${ctrl}+A`], description: 'Select all slots' },
        { keys: [`${ctrl}+C`], description: 'Copy selection' },
        { keys: [`${ctrl}+X`], description: 'Cut selection' },
        { keys: [`V`], description: 'Cycle paste mode (Replace/Merge)' },
        { keys: ['Del'], description: 'Delete selection' },
        { keys: ['Esc'], description: 'Clear selection' },
      ],
    },
    {
      category: 'Item Management',
      items: [
        { keys: ['/'], description: 'Focus item search' },
        { keys: ['Esc'], description: 'Clear selected item / Close search' },
        { keys: [`${alt}+Click`], description: 'Select item from slot' },
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
        { keys: ['Click+Drag'], description: 'Move item' },
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
