import { ClientEvents } from './client-events';
import logger from '../log';

export type ClassifiedClients = {
  base: ClientEvents;
  matching: ClientEvents[];
  mismatched: ClientEvents[];
  referenceTicks: ReferenceSelection;
};

export const enum ReferenceSelectionMethod {
  ACCURATE_MODAL = 'ACCURATE_MODAL',
  PRECISE_SERVER = 'PRECISE_SERVER',
  IMPRECISE_SERVER = 'IMPRECISE_SERVER',
  RECORDED_TICKS = 'RECORDED_TICKS',
}

export type ReferenceSelection = {
  count: number;
  method: ReferenceSelectionMethod;
  details?: Record<string, unknown>;
};

/**
 * From a list of clients, finds the modal tick count. If there is a tie for
 * the mode, the highest tick count is chosen.
 * @param clients The clients to find the consensus tick count from.
 * @param key The key to get the tick count from.
 * @returns The consensus tick count, or null if clients is empty.
 */
function getConsensusTicks(
  clients: ClientEvents[],
  key: (c: ClientEvents) => number,
): number {
  if (clients.length === 0) {
    throw new Error('No clients from which to get consensus tick count');
  }

  const counts = new Map<number, number>();
  for (const client of clients) {
    const k = key(client);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const maxCount = Math.max(...counts.values());
  const modes = [...counts.keys()].filter((k) => counts.get(k) === maxCount);

  return Math.max(...modes);
}

/**
 * Splits clients into three categories: a single reference client, clients with
 * complete tick data, and clients with partial tick data.
 *
 * Preconditions: `clients` is nonempty.
 *
 * @param clients Nonempty list of clients to classify.
 * @returns The classified clients and a reference tick count for the stage.
 */
export function classifyClients(clients: ClientEvents[]): ClassifiedClients {
  let baseClient: ClientEvents | null = null;
  let referenceTicks = 0;
  let selectionMethod: ReferenceSelectionMethod;
  let selectionDetails: Record<string, unknown> | undefined;

  // 1. Prioritize accurate clients.
  const accurateClients = clients.filter((c) => c.isAccurate());
  if (accurateClients.length > 0) {
    referenceTicks = getConsensusTicks(accurateClients, (c) =>
      c.getFinalTick(),
    );
    selectionMethod = ReferenceSelectionMethod.ACCURATE_MODAL;

    const candidates = accurateClients.filter(
      (c) => c.getFinalTick() === referenceTicks,
    );

    // Tie-break by lowest client ID.
    candidates.sort((a, b) => a.getId() - b.getId());
    baseClient = candidates[0];

    const accurateTickCounts = new Map<number, number>();
    for (const client of accurateClients) {
      const ticks = client.getFinalTick();
      accurateTickCounts.set(ticks, (accurateTickCounts.get(ticks) ?? 0) + 1);
    }
    selectionDetails = {
      accurateTickCounts: [...accurateTickCounts.entries()].sort(
        (a, b) => a[0] - b[0],
      ),
      accurateClientIds: accurateClients
        .map((c) => c.getId())
        .sort((a, b) => a - b),
    };
  }

  // 2. If no accurate client exists, pick a precise client with the highest
  //    recorded tick count.
  if (baseClient === null) {
    const preciseClients = clients.filter(
      (c) => c.getServerTicks()?.precise === true,
    );
    if (preciseClients.length > 0) {
      preciseClients.sort(
        (a, b) => b.getFinalTick() - a.getFinalTick() || a.getId() - b.getId(),
      );
      baseClient = preciseClients[0];
      referenceTicks = baseClient.getServerTicks()!.count;
      selectionMethod = ReferenceSelectionMethod.PRECISE_SERVER;
      selectionDetails = {
        candidateClientIds: preciseClients.map((c) => c.getId()),
      };
    }
  }

  // 3. If no precise client exists, pick a client with an imprecise server tick
  //    count, again with the highest recorded tick count.
  if (baseClient === null) {
    const impreciseClients = clients.filter(
      (c) => c.getServerTicks()?.precise === false,
    );
    if (impreciseClients.length > 0) {
      impreciseClients.sort(
        (a, b) => b.getFinalTick() - a.getFinalTick() || a.getId() - b.getId(),
      );
      baseClient = impreciseClients[0];
      referenceTicks = baseClient.getServerTicks()!.count;
      selectionMethod = ReferenceSelectionMethod.IMPRECISE_SERVER;
      selectionDetails = {
        candidateClientIds: impreciseClients.map((c) => c.getId()),
      };
    }
  }

  // 4. Finally, if no client has a server tick count, use the one with the
  //    highest recorded tick count.
  if (baseClient === null) {
    const sortedClients = clients.toSorted(
      (a, b) => b.getFinalTick() - a.getFinalTick() || a.getId() - b.getId(),
    );
    baseClient = sortedClients[0];
    referenceTicks = baseClient.getFinalTick();
    selectionMethod = ReferenceSelectionMethod.RECORDED_TICKS;
    selectionDetails = {
      candidateClientIds: sortedClients.map((c) => c.getId()),
    };
  }

  if (baseClient === null) {
    // This should not be reachable if `clients` is non-empty.
    throw new Error('Could not determine a reference client');
  }

  logger.debug('merge_classification_reference_selection', {
    referenceTicks,
    selectionMethod: selectionMethod!,
    selectionDetails,
  });

  const matching: ClientEvents[] = [];
  const mismatched: ClientEvents[] = [];

  for (const client of clients) {
    if (client.getId() === baseClient.getId()) {
      continue;
    }

    const isMatching =
      baseClient.isAccurate() &&
      client.isAccurate() &&
      client.getFinalTick() === referenceTicks;

    if (isMatching) {
      matching.push(client);
    } else {
      mismatched.push(client);
    }
  }

  const selection: ReferenceSelection = {
    count: referenceTicks,
    method: selectionMethod!,
    details: selectionDetails,
  };

  return {
    base: baseClient,
    matching,
    mismatched,
    referenceTicks: selection,
  };
}
