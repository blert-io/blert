import { NextRequest } from 'next/server';

import {
  ChainTransition,
  dryRunHistoricNameChange,
  submitHistoricNameChange,
} from '@/actions/historic-name-changes';
import { withApiRoute } from '@/api/handler';

import { validateAdminAuth } from '../auth';

type TransitionInput = {
  oldName: string;
  newName: string;
  effectiveFrom: string;
};

type HistoricNameChangeRequest = {
  chain: TransitionInput[];
  dryRun?: boolean;
};

function isTransitionInput(value: unknown): value is TransitionInput {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const t = value as Record<string, unknown>;
  return (
    typeof t.oldName === 'string' &&
    typeof t.newName === 'string' &&
    typeof t.effectiveFrom === 'string'
  );
}

/**
 * Endpoint which preview or apply a player's historic name change sequence.
 * A request with `dryRun` omitted or `true` returns the migration plan without
 * mutating anything.
 */
export const POST = withApiRoute(
  { route: '/api/admin/historic-name-changes' },
  async (request: NextRequest) => {
    const authHeader = request.headers.get('authorization');
    if (!validateAdminAuth(authHeader)) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }

    let body: HistoricNameChangeRequest;
    try {
      body = (await request.json()) as HistoricNameChangeRequest;
    } catch {
      return Response.json({ error: 'invalid_body' }, { status: 400 });
    }

    if (!Array.isArray(body.chain) || !body.chain.every(isTransitionInput)) {
      return Response.json({ error: 'invalid_chain' }, { status: 400 });
    }

    const chain: ChainTransition[] = [];
    for (const transition of body.chain) {
      const effectiveFrom = new Date(transition.effectiveFrom);
      if (isNaN(effectiveFrom.getTime())) {
        return Response.json({ error: 'invalid_date' }, { status: 400 });
      }
      chain.push({
        oldName: transition.oldName,
        newName: transition.newName,
        effectiveFrom,
      });
    }

    if (body.dryRun === false) {
      const submission = await submitHistoricNameChange(chain);
      if (!submission.ok) {
        return Response.json({ error: submission.error }, { status: 400 });
      }
      return Response.json({ sequenceId: submission.sequenceId });
    }

    const result = await dryRunHistoricNameChange(chain);
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json({ plan: result.plan });
  },
);
