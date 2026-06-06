import { Event } from '@blert/common/generated/event_pb';

import { ReferenceSelectionMethod } from '../classification';
import { ConsistencyIssue, ConsistencyIssueType } from '../client-consistency';
import { ClientEvents } from '../client-events';
import { MergeClientStatus, MergeContext, RegisteredClient } from '../context';
import { createMergeContext } from './fixtures';
import { QualityFlag } from '../quality';
import { MergeMapping } from '../tick-mapping';
import {
  computeTrustedPrefixes,
  recordContestedTicks,
  TrustedPrefixOptions,
} from '../trusted-prefixes';

type ClientSpec = {
  id: number;
  spectator?: boolean;
  presentUntil?: number;
  firstIssueTick?: number;
};

function buildClients(specs: ClientSpec[]): Map<number, RegisteredClient> {
  const clients = new Map<number, RegisteredClient>();
  for (const spec of specs) {
    const issues: ConsistencyIssue[] =
      spec.firstIssueTick !== undefined
        ? [
            {
              type: ConsistencyIssueType.BAD_DATA,
              tick: spec.firstIssueTick,
              message: 'test',
            },
          ]
        : [];
    clients.set(spec.id, {
      status: MergeClientStatus.MERGED,
      client: {
        getId: () => spec.id,
        getConsistencyIssues: () => issues,
        isSpectator: () => spec.spectator ?? false,
      } as unknown as ClientEvents,
    });
  }
  return clients;
}

function buildMapping(specs: ClientSpec[]): MergeMapping {
  const presentUntil = new Map(
    specs.map((s) => [s.id, s.presentUntil ?? Infinity]),
  );
  return {
    resolveClientTick: (mergedTick: number, clientId: number) =>
      mergedTick < (presentUntil.get(clientId) ?? 0) ? mergedTick : undefined,
  } as unknown as MergeMapping;
}

function buildContext(
  specs: ClientSpec[],
  contestedTicks = new Map<number, Set<number>>(),
): MergeContext {
  return createMergeContext({
    clients: buildClients(specs),
    mapping: buildMapping(specs),
    contestedTicks,
  });
}

function promotion(totalTicks: number, offset = 0): TrustedPrefixOptions {
  return {
    totalTicks,
    offset,
    inheritedAccuracy: false,
    referenceMethod: ReferenceSelectionMethod.RECORDED_TICKS,
  };
}

function inherited(totalTicks: number): TrustedPrefixOptions {
  return {
    totalTicks,
    offset: 0,
    inheritedAccuracy: true,
    referenceMethod: ReferenceSelectionMethod.ACCURATE_MODAL,
  };
}

describe('computeTrustedPrefixes', () => {
  it('spans the full duration when accuracy is inherited, ignoring coverage', () => {
    const ctx = buildContext([{ id: 1 }, { id: 2, presentUntil: 5 }]);
    expect(computeTrustedPrefixes(ctx, inherited(10))).toEqual({
      accurateUntil: 10,
      queryableUntil: 10,
    });
  });

  it('promotes the full timeline when two participants cover it', () => {
    const ctx = buildContext([{ id: 1 }, { id: 2 }]);
    expect(computeTrustedPrefixes(ctx, promotion(10))).toEqual({
      accurateUntil: 10,
      queryableUntil: 10,
    });
  });

  it('cuts the prefix where fewer than two clients have data', () => {
    const ctx = buildContext([{ id: 1 }, { id: 2, presentUntil: 5 }]);
    expect(computeTrustedPrefixes(ctx, promotion(10))).toEqual({
      accurateUntil: 5,
      queryableUntil: 5,
    });
  });

  it('cannot promote a single-client timeline', () => {
    const ctx = buildContext([{ id: 1 }]);
    expect(computeTrustedPrefixes(ctx, promotion(10))).toEqual({
      accurateUntil: 0,
      queryableUntil: 0,
    });
  });

  it('requires a participant to promote without a server-verified start', () => {
    const ctx = buildContext([
      { id: 1, spectator: true },
      { id: 2, spectator: true },
    ]);
    expect(computeTrustedPrefixes(ctx, promotion(10))).toEqual({
      accurateUntil: 0,
      queryableUntil: 0,
    });
  });

  it('waives the participant requirement when a precise server count matches the length', () => {
    const ctx = buildContext([
      { id: 1, spectator: true },
      { id: 2, spectator: true },
    ]);
    expect(
      computeTrustedPrefixes(ctx, {
        totalTicks: 10,
        offset: 0,
        inheritedAccuracy: false,
        referenceMethod: ReferenceSelectionMethod.PRECISE_SERVER,
      }),
    ).toEqual({ accurateUntil: 10, queryableUntil: 10 });
  });

  it('does not waive the participant requirement for an imprecise server count', () => {
    const ctx = buildContext([
      { id: 1, spectator: true },
      { id: 2, spectator: true },
    ]);
    expect(
      computeTrustedPrefixes(ctx, {
        totalTicks: 10,
        offset: 0,
        inheritedAccuracy: false,
        referenceMethod: ReferenceSelectionMethod.IMPRECISE_SERVER,
      }),
    ).toEqual({ accurateUntil: 0, queryableUntil: 0 });
  });

  it('breaks contiguity at a client self-detected consistency issue', () => {
    const ctx = buildContext([{ id: 1 }, { id: 2, firstIssueTick: 4 }]);
    expect(computeTrustedPrefixes(ctx, promotion(10))).toEqual({
      accurateUntil: 4,
      queryableUntil: 4,
    });
  });

  it('does not promote when an offset exists', () => {
    const ctx = buildContext([{ id: 1 }, { id: 2 }]);
    expect(computeTrustedPrefixes(ctx, promotion(10, 3))).toEqual({
      accurateUntil: 0,
      queryableUntil: 0,
    });
  });

  it('tightens only queryableUntil at a contested tick', () => {
    const ctx = buildContext([{ id: 1 }], new Map([[1, new Set([6])]]));
    expect(computeTrustedPrefixes(ctx, inherited(10))).toEqual({
      accurateUntil: 10,
      queryableUntil: 6,
    });
  });

  it('takes queryableUntil as the earlier of coverage loss and contention', () => {
    const ctx = buildContext(
      [{ id: 1 }, { id: 2, presentUntil: 7 }],
      new Map([[1, new Set([3])]]),
    );
    expect(computeTrustedPrefixes(ctx, promotion(10))).toEqual({
      accurateUntil: 7,
      queryableUntil: 3,
    });
  });
});

describe('recordContestedTicks', () => {
  function context(
    resolve: (tick: number, clientId: number) => number | undefined,
  ): MergeContext {
    return createMergeContext({
      mapping: { resolveClientTick: resolve } as unknown as MergeMapping,
    });
  }

  function attackTypeMismatch(tick: number): QualityFlag {
    return {
      kind: 'ATTACK_TYPE_MISMATCH',
      tick,
      player: 'p1',
      keptType: 0,
      discardedType: 1,
      keptSourceClientId: 1,
      discardedSourceClientId: 2,
    };
  }

  const largeGap: QualityFlag = {
    kind: 'LARGE_TEMPORAL_GAP',
    eventType: Event.Type.PLAYER_ATTACK,
    tickGap: 5,
    baseTick: 0,
    targetTick: 5,
  };

  it('records a contested tick at the resolved client tick', () => {
    const ctx = context((tick) => tick + 100);
    recordContestedTicks(ctx, 2, [attackTypeMismatch(5)]);
    expect(ctx.contestedTicks).toEqual(new Map([[2, new Set([105])]]));
  });

  it('ignores flags that are not content disagreements', () => {
    const ctx = context((tick) => tick);
    recordContestedTicks(ctx, 2, [largeGap]);
    expect(ctx.contestedTicks.size).toBe(0);
  });

  it('skips a flag whose tick does not map into the client', () => {
    const ctx = context(() => undefined);
    recordContestedTicks(ctx, 2, [attackTypeMismatch(5)]);
    expect(ctx.contestedTicks.size).toBe(0);
  });

  it('records contention at the attack tick of an UNEXPECTED_CONFLICT', () => {
    const ctx = context((tick) => tick);
    const unexpected: QualityFlag = {
      kind: 'UNEXPECTED_CONFLICT',
      eventType: Event.Type.TOB_VERZIK_BOUNCE,
      attackTick: 8,
      keptSourceClientId: 1,
      discardedSourceClientId: 2,
    };
    recordContestedTicks(ctx, 2, [attackTypeMismatch(5), unexpected, largeGap]);
    expect(ctx.contestedTicks).toEqual(new Map([[2, new Set([5, 8])]]));
  });
});
