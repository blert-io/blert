'use client';

import {
  ChallengeStatus,
  ChallengeType,
  SplitType,
  Stage,
  stageName,
  TfaRaid,
} from '@blert/common';
import Image from 'next/image';
import Link from 'next/link';
import { Fragment } from 'react';

import { useLiveChallenge } from '@/challenge-context';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import {
  challengeSlug,
  relevantSplitsForStage,
  statusNameAndColor,
} from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl, stagePath } from '@/utils/url';

import styles from './style.module.scss';

export type BossState =
  | 'live'
  | 'wiped'
  | 'reset'
  | 'completed'
  | 'notChosen'
  | 'missing'
  | 'next'
  | 'notReached';

type Column = 'left' | 'right' | 'center';

const ROWS: Stage[][] = [
  [Stage.TFA_GUARDIAN],
  [Stage.TFA_BORK, Stage.TFA_EZEKIEL],
  [Stage.TFA_DREADNOTH, Stage.TFA_MOIA],
  [Stage.TFA_XARTH, Stage.TFA_DAGONHAI],
  [Stage.TFA_OCELLUS],
];

const ROW_LABELS = ['Start', 'Row 1', 'Row 2', 'Row 3', 'Final'];

const PATH_STATES: BossState[] = ['live', 'wiped', 'reset', 'completed'];

const STATE_CLASSES: Record<BossState, string> = {
  live: styles.onPath,
  wiped: styles.wiped,
  reset: styles.onPath,
  completed: styles.onPath,
  notChosen: `${styles.inactive} ${styles.notChosen}`,
  missing: `${styles.inactive} ${styles.missing}`,
  next: `${styles.inactive} ${styles.next}`,
  notReached: `${styles.inactive} ${styles.notReached}`,
};

const STATE_NOTES: Partial<Record<BossState, string>> = {
  notChosen: 'Not taken',
  missing: 'Not recorded',
  next: 'Next choice',
  notReached: 'Not reached',
};

function rowOf(stage: Stage): number {
  return ROWS.findIndex((row) => row.includes(stage));
}

export function bossState(
  raid: Pick<TfaRaid, 'status' | 'stage' | 'tfa'>,
  stage: Stage,
  liveStage: Stage | null,
): BossState {
  const played = (s: Stage) => raid.tfa.bosses.some((boss) => boss.stage === s);

  if (stage === liveStage && !played(stage)) {
    return 'live';
  }
  if (stage === raid.stage && raid.status === ChallengeStatus.WIPED) {
    return 'wiped';
  }
  if (stage === raid.stage && raid.status === ChallengeStatus.RESET) {
    return 'reset';
  }
  if (played(stage)) {
    return 'completed';
  }

  const row = rowOf(stage);
  const other = ROWS[row].find((s) => s !== stage);
  if (
    other !== undefined &&
    (played(other) || other === liveStage || other === raid.stage)
  ) {
    return 'notChosen';
  }
  if (stage === raid.stage || row < rowOf(raid.stage)) {
    return 'missing';
  }
  if (
    raid.status === ChallengeStatus.IN_PROGRESS &&
    row === rowOf(raid.stage) + 1
  ) {
    return 'next';
  }
  return 'notReached';
}

function takenColumn(row: Stage[], states: BossState[]): Column | null {
  let index = states.findIndex((state) => PATH_STATES.includes(state));
  if (
    index === -1 &&
    states.filter((state) => state === 'missing').length === 1
  ) {
    index = states.indexOf('missing');
  }
  if (index === -1) {
    return null;
  }
  if (row.length === 1) {
    return 'center';
  }
  return index === 0 ? 'left' : 'right';
}

type BossCardProps = {
  raid: TfaRaid;
  stage: Stage;
  state: BossState;
  splits: Partial<Record<SplitType, number>>;
};

function BossCard({ raid, stage, state, splits }: BossCardProps) {
  const className = `${styles.boss} ${STATE_CLASSES[state]}`;
  const image = (
    <div className={styles.bossImg}>
      <Image
        src={`/images/tfa/${stagePath(stage)}.webp`}
        alt={stageName(stage)}
        fill
        className={styles.bossArt}
      />
    </div>
  );

  const note = STATE_NOTES[state];
  if (note !== undefined) {
    return (
      <div className={className}>
        {image}
        <div className={styles.roomDetails}>
          <h4 className={styles.bossName}>
            <span className={styles.nameText}>{stageName(stage)}</span>
          </h4>
          <div
            className={`${styles.stateNote} ${state === 'next' ? styles.next : ''}`}
          >
            {state === 'missing' && (
              <i className="fa-solid fa-circle-question" />
            )}
            {note}
          </div>
        </div>
      </div>
    );
  }

  const boss = raid.tfa.bosses.find((b) => b.stage === stage);
  const ticks = splits[relevantSplitsForStage(stage)[0]];
  const deaths = boss?.deaths ?? [];

  return (
    <Link
      href={`${challengeUrl(ChallengeType.TFA, raid.uuid)}/${stagePath(stage)}`}
      className={className}
    >
      {image}
      <div className={styles.roomDetails}>
        <h4 className={styles.bossName}>
          <span className={styles.nameText}>{stageName(stage)}</span>
          {state === 'live' && (
            <div className={styles.liveBadge}>
              <span className={styles.liveDot} />
              LIVE
            </div>
          )}
          {boss !== undefined && ticks !== undefined && (
            <>
              <i className={`fa-solid fa-hourglass ${styles.hourglass}`} />
              <span className={styles.time}>
                {ticksToFormattedSeconds(ticks)}
              </span>
            </>
          )}
          {deaths.length > 0 && (
            <div
              className={styles.deathCount}
              data-tooltip-id={GLOBAL_TOOLTIP_ID}
              data-tooltip-content={`Deaths: ${deaths.join(', ')}`}
            >
              <i className="fa-solid fa-skull" />
              {deaths.length}
            </div>
          )}
        </h4>
        {(state === 'wiped' || state === 'reset') && (
          <div className={styles.statusRow}>
            <span
              className={`${styles.statusBadge} ${state === 'wiped' ? styles.wipe : styles.reset}`}
            >
              <i
                className={`fa-solid ${state === 'wiped' ? 'fa-x' : 'fa-undo'}`}
              />
              {statusNameAndColor(raid.status)[0]}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

type BossRouteProps = {
  raid: TfaRaid;
};

export function BossRoute({ raid }: BossRouteProps) {
  const { currentStage, isStreaming, liveSplits } = useLiveChallenge();
  const splits = { ...liveSplits, ...raid.splits };

  const liveStage =
    currentStage?.stage && isStreaming ? currentStage.stage : null;

  const states = ROWS.map((row) =>
    row.map((stage) => bossState(raid, stage, liveStage)),
  );
  const taken = ROWS.map((row, i) => takenColumn(row, states[i]));

  return (
    <div
      className={styles.bossRoute}
      data-challenge={challengeSlug(ChallengeType.TFA)}
    >
      {ROWS.map((row, i) => {
        const from = i > 0 ? taken[i - 1] : null;
        const to = taken[i];
        const pending =
          from !== null && to === null && states[i].includes('next');
        const fork = pending && row.length === 2;

        let linkClass = styles.routeLink;
        if (i === 0) {
          linkClass += ` ${styles.first}`;
        }
        if (pending) {
          linkClass += ` ${styles.pending}`;
        }

        let rowClass = styles.routeRow;
        if (row.length === 1) {
          rowClass += ` ${styles.single}`;
        }
        if (i === ROWS.length - 1) {
          rowClass += ` ${styles.final}`;
        }

        return (
          <Fragment key={i}>
            <div
              className={linkClass}
              data-from={from ?? 'center'}
              data-to={to ?? 'center'}
            >
              <span className={styles.rowLabel}>{ROW_LABELS[i]}</span>
              {from !== null && (to !== null || pending) && (
                <>
                  <span className={styles.linkUp} />
                  <span
                    className={`${styles.linkAcross} ${fork ? styles.fork : ''}`}
                  />
                  {fork ? (
                    <>
                      <span
                        className={`${styles.linkDown} ${styles.forkLeft}`}
                      />
                      <span
                        className={`${styles.linkDown} ${styles.forkRight}`}
                      />
                    </>
                  ) : (
                    <span className={styles.linkDown} />
                  )}
                </>
              )}
            </div>
            <div className={rowClass}>
              {row.map((stage, j) => (
                <BossCard
                  key={stage}
                  raid={raid}
                  stage={stage}
                  state={states[i][j]}
                  splits={splits}
                />
              ))}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
