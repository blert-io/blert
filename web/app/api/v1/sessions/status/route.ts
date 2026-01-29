import { NextRequest } from 'next/server';

import { getSessionStatuses } from '@/actions/challenge';

export async function GET(request: NextRequest) {
  const uuids = request.nextUrl.searchParams.get('uuids');
  if (uuids === null || uuids === '') {
    return Response.json([]);
  }

  const uuidList = uuids.split(',');
  const statuses = await getSessionStatuses(uuidList);
  return Response.json(statuses);
}
