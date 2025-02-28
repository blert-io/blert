import { NextRequest } from 'next/server';

import { getSetups, SetupFilter } from '@/actions/setup';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get('limit') ?? '10');

  if (isNaN(limit)) {
    return new Response(null, { status: 400 });
  }

  const filter: SetupFilter = {
    state: 'published',
    orderBy: 'score',
  };

  try {
    const setups = await getSetups(filter, /*cursor=*/ null, limit);
    return Response.json(setups.setups);
  } catch (error) {
    console.error(error);
    return new Response(null, { status: 500 });
  }
}
