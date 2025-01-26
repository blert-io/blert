import { ChallengeType } from '@blert/common';

import { loadChallenge } from '@/actions/challenge';

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const raid = await loadChallenge(ChallengeType.TOB, id);
  if (raid === null) {
    return new Response(null, { status: 404 });
  }
  return Response.json(raid);
}
