import { loadRaid } from '../../../../../actions/raid';

type Params = {
  params: { id: string };
};

export async function GET(request: Request, { params }: Params) {
  const raid = await loadRaid(params.id);
  if (raid === null) {
    return new Response(null, { status: 404 });
  }
  return Response.json(raid);
}
