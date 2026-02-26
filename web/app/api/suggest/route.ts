import { NextRequest } from 'next/server';

import { Suggestions, suggestPlayers } from '@/actions/suggest';
import { withApiRoute } from '@/api/handler';

export const GET = withApiRoute(
  { route: '/api/suggest' },
  async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');
    const query = searchParams.get('q');
    if (type === null || query === null) {
      return new Response(null, { status: 400 });
    }

    let result: Suggestions;

    switch (type) {
      case 'players':
        result = await suggestPlayers(query, 10);
        break;
      default:
        return new Response(null, { status: 400 });
    }

    return Response.json(result);
  },
);
