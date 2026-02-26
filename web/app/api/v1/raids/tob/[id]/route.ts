import { ChallengeType } from '@blert/common';

import { loadChallenge } from '@/actions/challenge';
import { withApiRoute } from '@/api/handler';

export const GET = withApiRoute(
  { route: '/api/v1/raids/tob/[id]' },
  async (_, { params }) => {
    const { id } = await params;
    const raid = await loadChallenge(ChallengeType.TOB, id);
    if (raid === null) {
      return new Response(null, { status: 404 });
    }
    return Response.json(raid);
  },
);
