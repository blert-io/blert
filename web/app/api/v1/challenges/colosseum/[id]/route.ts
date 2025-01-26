import { ChallengeType } from '@blert/common';

import { loadChallenge } from '@/actions/challenge';

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const challenge = await loadChallenge(ChallengeType.COLOSSEUM, id);
  if (challenge === null) {
    return new Response(null, { status: 404 });
  }
  return Response.json(challenge);
}
