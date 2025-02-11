import { SetupCursor, SetupSort } from '@/actions/setup';

export function cursorFromParam(
  sort: SetupSort,
  direction: 'forward' | 'backward',
  cursorValue: string,
): SetupCursor | null {
  const values = cursorValue.split(',');
  if (values.length === 0) {
    return null;
  }

  const publicId = values[values.length - 1];

  if (sort === 'latest') {
    const timestamp = Number(values[0]);
    if (isNaN(timestamp)) {
      return null;
    }

    return {
      createdAt: new Date(timestamp),
      publicId,
      score: 0,
      views: 0,
      direction,
    };
  }

  if (values.length !== 3) {
    return null;
  }

  const value = Number(values[0]);
  const timestamp = Number(values[1]);
  if (isNaN(value) || isNaN(timestamp)) {
    return null;
  }

  const cursor: SetupCursor = {
    createdAt: new Date(timestamp),
    publicId,
    score: 0,
    views: 0,
    direction,
  };

  cursor[sort] = value;

  return cursor;
}
