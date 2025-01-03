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
 * Returns the Blert API URL for the challenge with the given ID.
 * @param type Type of challenge.
 * @param id Challenge ID.
 * @returns URL for the challenge's API endpoint.
 */
export function challengeApiUrl(type: ChallengeType, id: string): string {
  switch (type) {
    case ChallengeType.TOB:
      return `/api/v1/raids/tob/${id}`;
    case ChallengeType.COX:
      return `/api/v1/raids/cox/${id}`;
    case ChallengeType.TOA:
      return `/api/v1/raids/toa/${id}`;
    case ChallengeType.COLOSSEUM:
      return `/api/v1/challenges/colosseum/${id}`;
    case ChallengeType.INFERNO:
      return `/api/v1/challenges/inferno/${id}`;
  }

  return '/api/v1';
}

type SingleOrArray<T> = T | T[];
export type UrlParam = SingleOrArray<string | number> | undefined;
export type UrlParams = Record<string, UrlParam>;

export type NextSearchParams = Record<string, string | string[] | undefined>;

/**
 * Returns a URL query string from the given parameters.
 *
 * @param params Key-value pairs to encode. Undefined values are ignored.
 * @returns A URL query string.
 */
export function queryString(params: UrlParams): string {
  const searchParams = new URLSearchParams();
  for (let [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      value = value.join(',');
    }
    searchParams.set(key, value.toString());
  }
  return searchParams.toString();
}
