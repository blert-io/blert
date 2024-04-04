import { ChallengeType } from '@blert/common';

/**
 * Returns the Blert URL for the challenge with the given ID.
 * @param type Type of challenge.
 * @param id Challenge ID.
 * @returns URL for the challenge.
 */
export function challengeUrl(type: ChallengeType, id: string): string {
  switch (type) {
    case ChallengeType.TOB:
      return `/raids/tob/${id}`;
    case ChallengeType.COX:
      return `/raids/cox/${id}`;
    case ChallengeType.TOA:
      return `/raids/toa/${id}`;
    case ChallengeType.COLOSSEUM:
      return `/challenges/colosseum/${id}`;
    case ChallengeType.INFERNO:
      return `/challenges/inferno/${id}`;
  }

  return '/';
}

/**
 * Returns a URL query string from the given parameters.
 *
 * @param params Key-value pairs to encode. Undefined values are ignored.
 * @returns A URL query string.
 */
export function queryString(
  params: Record<string, string | undefined>,
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, value);
    }
  }
  return searchParams.toString();
}
