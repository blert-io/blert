import { ReferenceSelectionMethod } from './classification';
import { MergeClientStatus, MergeContext } from './context';
import { contestedFlagTick, QualityFlag } from './quality';
import { MergeMapping } from './tick-mapping';

export type TrustedPrefixOptions = {
  /** Length of the final merged timeline. */
  totalTicks: number;
  /** Leading offset applied by end alignment. */
  offset: number;
  /** Whether the merged output inherited accuracy from an accurate base. */
  inheritedAccuracy: boolean;
  /** How the stage's reference tick count was selected. */
  referenceMethod: ReferenceSelectionMethod;
};

export function recordContestedTicks(
  ctx: MergeContext,
  clientId: number,
  flags: QualityFlag[],
): void {
  for (const flag of flags) {
    const tick = contestedFlagTick(flag);
    if (tick === null) {
      continue;
    }
    const localTick = ctx.mapping.resolveClientTick(tick, clientId);
    if (localTick === undefined) {
      continue;
    }
    let contested = ctx.contestedTicks.get(clientId);
    if (contested === undefined) {
      contested = new Set();
      ctx.contestedTicks.set(clientId, contested);
    }
    contested.add(localTick);
  }
}

/**
 * The two trust prefixes of a finalized merged timeline.
 *
 * `accurateUntil` defines the exclusive tick at which the merged timeline can
 * no longer be trusted to match the true server tick count.
 *
 * `queryableUntil` defines the exclusive tick at which the merged event stream
 * can no longer be trusted for strict analysis.
 */
export type TrustedPrefixes = {
  accurateUntil: number;
  queryableUntil: number;
};

type Contributor = {
  id: number;
  /**
   * Earliest local tick at which the client self-detected a consistency issue,
   * or `Infinity` if none.
   */
  firstIssueTick: number;
  isParticipant: boolean;
};

type TickSupport = {
  /** Number of internally contiguous clients contributing to this tick. */
  contiguousCount: number;
  /** Whether any contiguous contributor is a participant. */
  hasParticipant: boolean;
  /** Whether any contributor's data was contested by other clients. */
  contested: boolean;
};

const NO_SUPPORT: TickSupport = {
  contiguousCount: 0,
  hasParticipant: false,
  contested: false,
};

function collectContributors(ctx: MergeContext): Contributor[] {
  const contributors: Contributor[] = [];
  for (const { client, status } of ctx.clients.values()) {
    if (status !== MergeClientStatus.MERGED) {
      continue;
    }
    const issues = client.getConsistencyIssues();
    contributors.push({
      id: client.getId(),
      firstIssueTick:
        issues.length > 0 ? Math.min(...issues.map((i) => i.tick)) : Infinity,
      isParticipant: !client.isSpectator(),
    });
  }
  return contributors;
}

/**
 * Resolves what the contributors corroborate on a single tick.
 */
function supportAtTick(
  mappingTick: number,
  contributors: readonly Contributor[],
  mapping: MergeMapping,
  contested: ReadonlyMap<number, ReadonlySet<number>>,
): TickSupport {
  let contiguousCount = 0;
  let hasParticipant = false;
  let isContested = false;

  for (const c of contributors) {
    const localTick = mapping.resolveClientTick(mappingTick, c.id);
    if (localTick === undefined) {
      continue;
    }
    if (contested.get(c.id)?.has(localTick)) {
      isContested = true;
    }
    if (c.firstIssueTick > localTick) {
      contiguousCount++;
      if (c.isParticipant) {
        hasParticipant = true;
      }
    }
  }

  return { contiguousCount, hasParticipant, contested: isContested };
}

/**
 * Computes the accurate and queryable prefixes of a finalized merged timeline.
 *
 * @param ctx The merge context.
 * @param opts Options for the computation.
 * @returns The accurate and queryable prefixes.
 */
export function computeTrustedPrefixes(
  ctx: MergeContext,
  opts: TrustedPrefixOptions,
): TrustedPrefixes {
  const { totalTicks, offset, inheritedAccuracy, referenceMethod } = opts;

  const contributors = collectContributors(ctx);

  // A precise server count whose length the timeline matches exactly proves the
  // timeline spans server tick 0 to the end.
  const knownToStartAtZero =
    offset === 0 && referenceMethod === ReferenceSelectionMethod.PRECISE_SERVER;

  // Inherited accuracy spans the full duration regardless of coverage.
  let accurateUntil = inheritedAccuracy ? totalTicks : -1;
  let queryableUntil = -1;

  for (let m = 0; m < totalTicks; m++) {
    const support =
      m >= offset
        ? supportAtTick(
            m - offset,
            contributors,
            ctx.mapping,
            ctx.contestedTicks,
          )
        : NO_SUPPORT;

    // `accurateUntil` requires at least two internally contiguous clients, with
    // either one participant or a server-verified tick 0.
    const lacksSufficientContributors =
      support.contiguousCount < 2 ||
      (!support.hasParticipant && !knownToStartAtZero);

    if (accurateUntil < 0 && lacksSufficientContributors) {
      accurateUntil = m;
    }
    if (
      queryableUntil < 0 &&
      ((!inheritedAccuracy && lacksSufficientContributors) || support.contested)
    ) {
      queryableUntil = m;
    }

    if (accurateUntil >= 0 && queryableUntil >= 0) {
      break;
    }
  }

  if (accurateUntil < 0) {
    accurateUntil = totalTicks;
  }
  if (queryableUntil < 0) {
    queryableUntil = totalTicks;
  }

  // Ensure that `queryableUntil` can never exceed `accurateUntil`.
  queryableUntil = Math.min(queryableUntil, accurateUntil);

  return { accurateUntil, queryableUntil };
}
