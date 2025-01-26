import { SplitType } from '@blert/common';
import { NextRequest } from 'next/server';

import { loadPbsForPlayer } from '@/actions/challenge';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const searchParams = request.nextUrl.searchParams;
  const splitParam = searchParams.get('split');
  const scaleParam = searchParams.get('scale');

  const splits = splitParam
    ? splitParam.split(',').map((s) => parseInt(s, 10))
    : undefined;
  const scales = scaleParam
    ? scaleParam.split(',').map((s) => parseInt(s, 10))
    : undefined;

  if (
    splits !== undefined &&
    !splits.every((split) => Object.values(SplitType).includes(split))
  ) {
    return new Response(null, { status: 400 });
  }

  if (
    scales !== undefined &&
    !scales.every((scale) => scale >= 1 && scale <= 8)
  ) {
    return new Response(null, { status: 400 });
  }

  try {
    const pbs = await loadPbsForPlayer(username, { splits, scales });
    if (pbs.length === 0) {
      return new Response(null, { status: 404 });
    }
    return Response.json(pbs);
  } catch (error) {
    console.error('Error loading personal bests:', error);
    return new Response(null, { status: 500 });
  }
}
