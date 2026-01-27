'use client';

import {
  ChallengeStatus,
  generalizeSplit,
  splitName,
  splitToStage,
  SplitType,
  Stage,
  stagesForChallenge,
} from '@blert/common';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';
import TimeAgo from 'react-timeago';

import { SessionChallenge, SplitValue } from '@/actions/challenge';
import Card from '@/components/card';
import RadioInput from '@/components/radio-input';
import SectionTitle from '@/components/section-title';
import { useToast } from '@/components/toast';
import { GLOBAL_TOOLTIP_ID } from '@/components/tooltip';
import { useClientOnly } from '@/hooks/client-only';
import {
  challengeTerm,
  relevantSplitsForStage,
  stageTerm,
  statusNameAndColor,
} from '@/utils/challenge';
import { ticksToFormattedSeconds } from '@/utils/tick';
import { challengeUrl } from '@/utils/url';

import { useSessionContext } from './session-context-provider';

import styles from './challenges-table.module.scss';

type SessionTag = {
  text: string;
  icon?: string;
};

type SortField =
  | 'index'
  | 'status'
  | 'startTime'
  | 'challengeTicks'
  | 'overallTicks'
  | 'deaths';
const enum SortDirection {
  ASC,
  DESC,
}

type StatusFilter =
  | 'all'
  | ChallengeStatus.COMPLETED
  | ChallengeStatus.WIPED
  | ChallengeStatus.RESET
  | ChallengeStatus.IN_PROGRESS;

type SortState = {
  field: SortField;
  direction: SortDirection;
};

function StatusBadge({
  status,
  stage,
}: {
  status: ChallengeStatus;
  stage: number;
}) {
  const [statusString, statusColor] = statusNameAndColor(status, stage);
  let statusIcon = 'fa-x';

  switch (status) {
    case ChallengeStatus.COMPLETED:
      statusIcon = 'fa-check';
      break;
    case ChallengeStatus.WIPED:
      statusIcon = 'fa-x';
      break;
    case ChallengeStatus.RESET:
      statusIcon = 'fa-undo';
      break;
    case ChallengeStatus.IN_PROGRESS:
      statusIcon = 'fa-ellipsis';
      break;
  }

  return (
    <span className={styles.statusBadge} style={{ color: statusColor }}>
      <i
        className={`fas ${statusIcon}`}
        style={{ top: status === ChallengeStatus.RESET ? 0 : 1 }}
      />
      {statusString}
    </span>
  );
}

const EXCLUDED_SPLITS = new Set([
  SplitType.TOB_SOTETSEG_P2,
  SplitType.TOB_SOTETSEG_P3,
  SplitType.TOB_NYLO_CAP,
  SplitType.TOB_XARPUS_P1,
  SplitType.TOB_XARPUS_P2,
  SplitType.TOB_XARPUS_P3,
]);

const MAX_DISPLAYED_TAGS = 3;

function ExpandedChallengeDetails({
  sessionTags,
  challenge,
}: {
  sessionTags: SessionTag[];
  challenge: SessionChallenge;
}) {
  const splits = Object.entries(challenge.splits ?? {});
  const splitsByStage = splits.reduce<Record<Stage, [SplitType, SplitValue][]>>(
    (acc, [splitType, splitValue]) => {
      const split = parseInt(splitType);

      if (EXCLUDED_SPLITS.has(generalizeSplit(split))) {
        return acc;
      }

      const stage = splitToStage(split);
      acc[stage] ??= [];
      acc[stage].push([split, splitValue]);
      return acc;
    },
    {},
  );

  const playerDeaths = challenge.party.reduce<Record<string, number>>(
    (acc, player) => {
      acc[player.username] = player.deaths.length;
      return acc;
    },
    {},
  );

  const displayedTags = sessionTags.slice(0, MAX_DISPLAYED_TAGS);
  const remainingTags = sessionTags.slice(MAX_DISPLAYED_TAGS);

  return (
    <div className={styles.expandedDetails}>
      <div className={styles.detailsGrid}>
        {sessionTags.length > 0 && (
          <div className={styles.detailItem}>
            <span className={styles.detailLabel}>
              <i className="fas fa-tags" />
              Tags
            </span>
            <span className={styles.detailValue}>
              <div className={styles.sessionTags}>
                {displayedTags.map((tag, index) => (
                  <span key={index} className={styles.sessionTag}>
                    {tag.icon && <i className={`fas ${tag.icon}`} />}
                    {tag.text}
                  </span>
                ))}
                {remainingTags.length > 0 && (
                  <span
                    className={`${styles.sessionTag} ${styles.moreTag}`}
                    data-tooltip-id={GLOBAL_TOOLTIP_ID}
                    data-tooltip-content={remainingTags
                      .map((tag) => tag.text)
                      .join(', ')}
                  >
                    +{remainingTags.length} more
                  </span>
                )}
              </div>
            </span>
          </div>
        )}

        <div className={styles.detailItem}>
          <span className={styles.detailLabel}>
            <i className="fas fa-skull" />
            Player Deaths
          </span>
          <div className={styles.playerDeaths}>
            {Object.entries(playerDeaths).map(([username, deaths]) => (
              <span key={username} className={styles.playerDeath}>
                {username}: {deaths}
              </span>
            ))}
          </div>
        </div>
      </div>

      {splits.length > 0 && (
        <div className={styles.splitsSection}>
          <h4 className={styles.detailsTitle}>
            {stageTerm(challenge.type)} Splits
          </h4>
          <div className={styles.splitsContainer}>
            {Object.entries(splitsByStage).map(([stage, splits]) => (
              <div key={stage} className={styles.stageGroup}>
                <div className={styles.splitsGrid}>
                  {splits.map(([split, { ticks, accurate }], index) => (
                    <div key={index} className={styles.splitItem}>
                      <span className={styles.splitType}>
                        {splitName(split, false, true)}
                      </span>
                      <span className={styles.splitTime}>
                        {ticksToFormattedSeconds(ticks)}
                        {!accurate && (
                          <span className={styles.inaccurate}>*</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {splits.some(([, split]) => !split.accurate) && (
            <p className={styles.inaccurateNote}>* Estimated timing</p>
          )}
        </div>
      )}

      {challenge.personalBests && challenge.personalBests.length > 0 && (
        <div className={styles.pbSection}>
          <h4 className={styles.detailsTitle}>Personal Bests Achieved</h4>
          <div className={styles.pbList}>
            {Object.entries(
              challenge.personalBests.reduce<Record<string, SplitType[]>>(
                (acc, pb) => {
                  acc[pb.player] ??= [];
                  acc[pb.player].push(pb.type);
                  return acc;
                },
                {},
              ),
            ).map(([player, splits]) => (
              <div key={player} className={styles.pbPlayerGroup}>
                <span className={styles.pbPlayerName}>
                  <i className="fas fa-user" />
                  {player}
                </span>
                <div className={styles.pbSplitsList}>
                  {splits.map((split, index) => (
                    <span key={index} className={styles.pbSplitTag}>
                      <i className="fas fa-trophy" />
                      {splitName(split)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className={styles.tableContainer}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Status</th>
            <th>Start Time</th>
            <th>Duration</th>
            <th>Overall</th>
            <th>Deaths</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, index) => (
            <tr key={index} className={styles.skeletonRow}>
              <td>
                <div className={styles.skeleton} />
              </td>
              <td>
                <div className={styles.skeleton} />
              </td>
              <td>
                <div className={styles.skeleton} />
              </td>
              <td>
                <div className={styles.skeleton} />
              </td>
              <td>
                <div className={styles.skeleton} />
              </td>
              <td>
                <div className={styles.skeleton} />
              </td>
              <td>
                <div className={styles.skeleton} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ChallengesTable() {
  const { session, isInitialLoad } = useSessionContext();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortState, setSortState] = useState<SortState>({
    field: 'index',
    direction: SortDirection.DESC,
  });
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const isClient = useClientOnly();
  const showToast = useToast();

  const [challengesByStatus, accurateSplitCounts, bestSessionSplits] =
    useMemo(() => {
      const byStatus = {
        [ChallengeStatus.COMPLETED]: 0,
        [ChallengeStatus.WIPED]: 0,
        [ChallengeStatus.RESET]: 0,
        [ChallengeStatus.IN_PROGRESS]: 0,
        [ChallengeStatus.ABANDONED]: 0,
      };
      const accurateSplitCounts: Partial<Record<SplitType, number>> = {};

      if (!session) {
        return [byStatus, accurateSplitCounts, {}];
      }

      const bestStageSplits = stagesForChallenge(session.challengeType)
        .map((stage) => relevantSplitsForStage(stage)[0])
        .reduce<
          Partial<Record<SplitType, { ticks: number; uuid: string | null }>>
        >((acc, split) => {
          acc[split] = { ticks: Infinity, uuid: null };
          return acc;
        }, {});

      for (const challenge of session.challenges) {
        byStatus[challenge.status]++;

        Object.entries(challenge.splits ?? {}).forEach(
          ([splitType, { accurate, ticks }]) => {
            if (!accurate) {
              return;
            }

            const generalizedSplit = generalizeSplit(parseInt(splitType));
            accurateSplitCounts[generalizedSplit] =
              (accurateSplitCounts[generalizedSplit] ?? 0) + 1;

            if (bestStageSplits[generalizedSplit] === undefined) {
              return;
            }

            if (accurate && ticks < bestStageSplits[generalizedSplit].ticks) {
              bestStageSplits[generalizedSplit] = {
                ticks,
                uuid: challenge.uuid,
              };
            }
          },
        );
      }

      const bestSplitChallenges: Record<string, SplitType[]> = {};
      for (const [split, { uuid }] of Object.entries(bestStageSplits)) {
        if (uuid === null) {
          continue;
        }
        bestSplitChallenges[uuid] ??= [];
        bestSplitChallenges[uuid].push(parseInt(split));
      }

      return [byStatus, accurateSplitCounts, bestSplitChallenges];
    }, [session]);

  if (isInitialLoad) {
    return (
      <Card>
        <SectionTitle icon="fa-table">Challenge Overview</SectionTitle>
        <div className={styles.filtersContainer}>
          <div className={styles.skeletonFilter} />
        </div>
        <TableSkeleton />
      </Card>
    );
  }

  if (session === null) {
    return (
      <Card>
        <SectionTitle icon="fa-table">Challenge Overview</SectionTitle>
        <div className={styles.errorState}>
          <i className="fas fa-exclamation-triangle" />
          <span>Failed to load challenge data</span>
        </div>
      </Card>
    );
  }

  const challengeLabel = challengeTerm(session.challengeType, true);

  if (session.challenges.length === 0) {
    return (
      <Card>
        <SectionTitle icon="fa-table">{challengeLabel} Overview</SectionTitle>
        <div className={styles.emptyState}>
          <i className="fas fa-bed" />
          <span>No {challengeLabel.toLowerCase()} recorded yet</span>
        </div>
      </Card>
    );
  }

  const filteredChallenges = session.challenges.filter((challenge) => {
    return statusFilter === 'all' || challenge.status === statusFilter;
  });

  filteredChallenges.sort((a, b) => {
    let comparison = 0;

    switch (sortState.field) {
      case 'index':
        comparison =
          session.challenges.indexOf(a) - session.challenges.indexOf(b);
        break;
      case 'status':
        comparison = a.status - b.status;
        break;
      case 'startTime':
        comparison = a.startTime.getTime() - b.startTime.getTime();
        break;
      case 'challengeTicks':
        comparison = a.challengeTicks - b.challengeTicks;
        break;
      case 'overallTicks':
        if (a.overallTicks === null && b.overallTicks === null) {
          comparison = 0;
        } else if (a.overallTicks === null) {
          comparison = 1;
        } else if (b.overallTicks === null) {
          comparison = -1;
        } else {
          comparison = a.overallTicks - b.overallTicks;
        }
        break;
      case 'deaths':
        comparison = a.totalDeaths - b.totalDeaths;
        break;
    }

    return sortState.direction === SortDirection.ASC ? comparison : -comparison;
  });

  const handleSort = (field: SortField) => {
    setSortState((prev) => ({
      field,
      direction:
        prev.field === field && prev.direction === SortDirection.ASC
          ? SortDirection.DESC
          : SortDirection.ASC,
    }));
  };

  const toggleExpanded = (challengeId: string) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(challengeId)) {
        newSet.delete(challengeId);
      } else {
        newSet.add(challengeId);
      }
      return newSet;
    });
  };

  const getSortIcon = (field: SortField) => {
    if (sortState.field !== field) {
      return 'fa-sort';
    }
    return sortState.direction === SortDirection.ASC
      ? 'fa-sort-up'
      : 'fa-sort-down';
  };

  const today = new Date();

  const formatStartTime = (startTime: Date) => {
    if (today.getFullYear() !== startTime.getFullYear()) {
      return startTime.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
    return startTime.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    });
  };

  function generateTagsForChallenge(challenge: SessionChallenge): SessionTag[] {
    const tags: SessionTag[] = [];

    const bestSplits = bestSessionSplits[challenge.uuid] ?? [];

    for (const split of bestSplits) {
      // Only label a split as a fastest time if there are multiple challenges
      // in the session with that split.
      if ((accurateSplitCounts[split] ?? 0) > 1) {
        tags.push({
          text: `Fastest ${splitName(split)}`,
          icon: 'fa-bolt',
        });
      }
    }

    return tags;
  }

  return (
    <Card>
      <SectionTitle icon="fa-table">{challengeLabel} Overview</SectionTitle>

      <div className={styles.filtersContainer}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Filter by status:</span>
          <RadioInput.Group
            name="challenge-status-filter"
            compact
            joined
            onChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <RadioInput.Option
              checked={statusFilter === 'all'}
              id="status-filter-all"
              label={`All (${session.challenges.length})`}
              value="all"
            />
            <RadioInput.Option
              checked={statusFilter === ChallengeStatus.COMPLETED}
              id="status-filter-completed"
              label={`Complete (${challengesByStatus[ChallengeStatus.COMPLETED] ?? 0})`}
              value={ChallengeStatus.COMPLETED}
            />
            <RadioInput.Option
              checked={statusFilter === ChallengeStatus.WIPED}
              id="status-filter-wiped"
              label={`Wipes (${challengesByStatus[ChallengeStatus.WIPED] ?? 0})`}
              value={ChallengeStatus.WIPED}
            />
            <RadioInput.Option
              checked={statusFilter === ChallengeStatus.RESET}
              id="status-filter-reset"
              label={`Resets (${challengesByStatus[ChallengeStatus.RESET] ?? 0})`}
              value={ChallengeStatus.RESET}
            />
            {challengesByStatus[ChallengeStatus.IN_PROGRESS] > 0 && (
              <RadioInput.Option
                checked={statusFilter === ChallengeStatus.IN_PROGRESS}
                id="status-filter-inprogress"
                label={`Live (${challengesByStatus[ChallengeStatus.IN_PROGRESS]})`}
                value={ChallengeStatus.IN_PROGRESS}
              />
            )}
          </RadioInput.Group>
        </div>
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th
                onClick={() => handleSort('index')}
                className={styles.sortableHeader}
              >
                #
                <i className={`fas ${getSortIcon('index')}`} />
              </th>
              <th
                onClick={() => handleSort('status')}
                className={styles.sortableHeader}
              >
                Status
                <i className={`fas ${getSortIcon('status')}`} />
              </th>
              <th
                onClick={() => handleSort('startTime')}
                className={styles.sortableHeader}
              >
                Start Time
                <i className={`fas ${getSortIcon('startTime')}`} />
              </th>
              <th
                onClick={() => handleSort('challengeTicks')}
                className={styles.sortableHeader}
              >
                Challenge Time
                <i className={`fas ${getSortIcon('challengeTicks')}`} />
              </th>
              <th
                onClick={() => handleSort('overallTicks')}
                className={styles.sortableHeader}
              >
                Overall Time
                <i className={`fas ${getSortIcon('overallTicks')}`} />
              </th>
              <th
                onClick={() => handleSort('deaths')}
                className={styles.sortableHeader}
              >
                Deaths
                <i className={`fas ${getSortIcon('deaths')}`} />
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredChallenges.map((challenge) => {
              const challengeNumber = session.challenges.indexOf(challenge) + 1;
              const isExpanded = expandedRows.has(challenge.uuid);
              const [, statusColor] = statusNameAndColor(
                challenge.status,
                challenge.stage,
              );

              return (
                <React.Fragment key={challenge.uuid}>
                  <tr
                    className={`${styles.tableRow} ${isExpanded ? styles.expandedRow : ''}`}
                  >
                    <td
                      className={styles.indexCell}
                      style={{ borderLeft: `4px solid ${statusColor}` }}
                    >
                      <div className={styles.indexCellContent}>
                        <button
                          className={styles.expandButton}
                          onClick={() => toggleExpanded(challenge.uuid)}
                          data-tooltip-id={GLOBAL_TOOLTIP_ID}
                          data-tooltip-content={
                            isExpanded ? 'Collapse details' : 'Expand details'
                          }
                        >
                          <i
                            className={`fas fa-chevron-${isExpanded ? 'up' : 'down'}`}
                          />
                        </button>
                        <span className={styles.challengeNumber}>
                          {challengeNumber}
                        </span>
                        {challenge.personalBests &&
                          challenge.personalBests.length > 0 && (
                            <i
                              className={`fas fa-star ${styles.pbStar}`}
                              data-tooltip-id={GLOBAL_TOOLTIP_ID}
                              data-tooltip-content={`One or more players set a personal best during this ${challengeTerm(
                                session.challengeType,
                              ).toLowerCase()}`}
                            />
                          )}
                      </div>
                    </td>
                    <td>
                      <StatusBadge
                        status={challenge.status}
                        stage={challenge.stage}
                      />
                    </td>
                    <td className={styles.timeCell}>
                      {isClient ? <TimeAgo date={challenge.startTime} /> : '-'}
                      <span className={styles.absoluteTime}>
                        {formatStartTime(challenge.startTime)}
                      </span>
                    </td>
                    <td className={styles.durationCell}>
                      {ticksToFormattedSeconds(challenge.challengeTicks)}
                    </td>
                    <td className={styles.durationCell}>
                      {challenge.overallTicks
                        ? ticksToFormattedSeconds(challenge.overallTicks)
                        : '-'}
                    </td>
                    <td className={styles.deathsCell}>
                      {challenge.totalDeaths}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        <Link
                          href={challengeUrl(
                            session.challengeType,
                            challenge.uuid,
                          )}
                          className={styles.actionButton}
                          data-tooltip-id={GLOBAL_TOOLTIP_ID}
                          data-tooltip-content={`View ${challengeTerm(session.challengeType)}`}
                        >
                          <i className="fas fa-eye" />
                        </Link>
                        <button
                          className={styles.actionButton}
                          data-tooltip-id={GLOBAL_TOOLTIP_ID}
                          data-tooltip-content="Copy Link"
                          onClick={() => {
                            const url = `${window.location.origin}${challengeUrl(session.challengeType, challenge.uuid)}`;
                            void navigator.clipboard.writeText(url);
                            showToast('Link copied to clipboard', 'success');
                          }}
                        >
                          <i className="fas fa-link" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className={styles.expandedDetailsRow}>
                      <td colSpan={7}>
                        <ExpandedChallengeDetails
                          sessionTags={generateTagsForChallenge(challenge)}
                          challenge={challenge}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredChallenges.length === 0 && statusFilter !== 'all' && (
        <div className={styles.emptyFilter}>
          <i className="fas fa-filter" />
          <span>
            No {challengeLabel.toLowerCase()} match the current filter
          </span>
          <button
            className={styles.clearFilterButton}
            onClick={() => setStatusFilter('all')}
          >
            Clear filter
          </button>
        </div>
      )}
    </Card>
  );
}
