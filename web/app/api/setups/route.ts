import { ChallengeType } from '@blert/common';
import { NextRequest } from 'next/server';

import {
  getSetups,
  SetupFilter,
  SetupSort,
  SetupCursor,
  SetupState,
} from '@/actions/setup';
import { clamp } from '@/utils/math';

function isSetupState(state: string): state is SetupState {
  return state === 'draft' || state === 'published' || state === 'archived';
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const limitParam = Number.parseInt(searchParams.get('limit') ?? '10');
  const limit = Number.isInteger(limitParam) ? clamp(limitParam, 1, 50) : 10;

  const after = searchParams.get('after');
  const before = searchParams.get('before');
  const sort = searchParams.get('sort') ?? 'latest';

  let cursor: SetupCursor | null = null;
  if (after || before) {
    const cursorData = after ?? before;
    const direction = after ? 'forward' : 'backward';

    try {
      const values = cursorData!.split(',');

      switch (sort) {
        case 'score':
          if (values.length >= 3) {
            cursor = {
              score: parseFloat(values[0]),
              createdAt: new Date(parseInt(values[1])),
              publicId: values[2],
              direction,
              views: 0,
            };
          }
          break;
        case 'views':
          if (values.length >= 3) {
            cursor = {
              views: parseInt(values[0]),
              createdAt: new Date(parseInt(values[1])),
              publicId: values[2],
              direction,
              score: 0,
            };
          }
          break;
        default:
          if (values.length >= 2) {
            cursor = {
              createdAt: new Date(parseInt(values[0])),
              publicId: values[1],
              direction,
              score: 0,
              views: 0,
            };
          }
      }
    } catch (e) {
      return Response.json({ error: 'Invalid cursor' }, { status: 400 });
    }
  }

  const filter: SetupFilter = {
    orderBy: (sort === 'score' || sort === 'views'
      ? sort
      : 'latest') as SetupSort,
  };

  const state = searchParams.get('state');
  if (state !== null && isSetupState(state)) {
    filter.state = state;
  }

  const challenge = searchParams.get('challenge');
  if (challenge !== null) {
    const challengeType = parseInt(challenge);
    if (!isNaN(challengeType)) {
      filter.challenge = challengeType as ChallengeType;
    }
  }

  const scale = searchParams.get('scale');
  if (scale !== null) {
    const scaleNum = parseInt(scale);
    if (!isNaN(scaleNum) && scaleNum >= 1 && scaleNum <= 8) {
      filter.scale = scaleNum;
    }
  }

  const search = searchParams.get('search');
  if (search !== null && search.trim().length > 0) {
    filter.search = search.trim();
  }

  const author = searchParams.get('author');
  if (author !== null) {
    const authorId = parseInt(author);
    if (Number.isInteger(authorId)) {
      filter.author = authorId;
    }
  }

  try {
    const result = await getSetups(filter, cursor, limit);

    return Response.json({
      setups: result.setups,
      nextCursor: result.nextCursor,
      prevCursor: result.prevCursor,
      total: result.total,
      remaining: result.remaining,
    });
  } catch (error) {
    console.error('Setups API error:', error);
    return Response.json({ error: 'Failed to fetch setups' }, { status: 500 });
  }
}
