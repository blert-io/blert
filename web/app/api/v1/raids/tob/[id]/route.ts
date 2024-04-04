import { ChallengeType } from '@blert/common';
import { loadChallenge } from '../../../../../actions/challenge';

type Params = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Params) {
  const raid = await loadChallenge(ChallengeType.TOB, params.id);
  if (raid === null) {
    return new Response(null, { status: 404 });
  }
  return Response.json(raid);
}
