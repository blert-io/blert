import { ChallengeType } from '@blert/common';
import { loadChallenge } from '../../../../../actions/challenge';

type Params = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Params) {
  const challenge = await loadChallenge(ChallengeType.COLOSSEUM, params.id);
  if (challenge === null) {
    return new Response(null, { status: 404 });
  }
  return Response.json(challenge);
}
