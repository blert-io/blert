'use client';

import { ChallengeType, challengeName } from '@blert/common';
import { useEffect, useState } from 'react';

import Button from '@/components/button';
import EditableTextField from '@/components/editable-text-field';
import RadioInput from '@/components/radio-input';

import {
  EditableGearSetup,
  EditingContext,
  SetupEditingContext,
} from '../editing-context';
import { Player } from '../player';
import { NEW_GEAR_SETUP, newGearSetupPlayer } from '../setup';
import { ItemSelector } from './item-selector';

import setupStyles from '../style.module.scss';
import styles from './style.module.scss';

const OVERVIEW_WIDTH = 900;

const MAX_PARTY_SIZE = 8;

export default function GearSetupsCreator() {
  const [editableSetup, setEditableSetup] = useState<EditableGearSetup>(
    EditingContext.newEditableGearSetup(NEW_GEAR_SETUP),
  );

  const context = new EditingContext(editableSetup, setEditableSetup);

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
            context.save();
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
  }, [context]);

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
              disabled={!editableSetup.modified}
              onClick={() => context.save()}
            >
              <i className="fas fa-save" />
              <span className="sr-only">Save</span>
            </button>
          </div>
          <div className={styles.publishing}>
            <Button className={styles.button} onClick={() => {}}>
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
    </SetupEditingContext.Provider>
  );
}
