import { NextRequest } from 'next/server';

import { findBestSplitTimes } from '@/actions/challenge';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const splits = (params.get('splits') ?? '')
    .split(',')
    .map((s) => parseInt(s));
  const scale = parseInt(params.get('scale') ?? '-1');
  const limit = parseInt(params.get('limit') ?? '10');

  if (scale === -1 || splits.length === 0 || splits.some(isNaN)) {
    return Response.json(null, { status: 400 });
  }

  let startTime: Date | undefined = undefined;
  if (params.get('from')) {
    const time = parseInt(params.get('from')!);
    if (isNaN(time)) {
      return Response.json(null, { status: 400 });
    }
    startTime = new Date(time);
  }

  const rankedSplits = await findBestSplitTimes(
    splits,
    scale,
    limit,
    startTime,
  );
  return Response.json(rankedSplits);
}
