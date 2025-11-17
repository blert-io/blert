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
    case ChallengeType.MOKHAIOTL:
      return `/challenges/mokhaiotl/${id}`;
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
    case ChallengeType.MOKHAIOTL:
      return `/api/v1/challenges/mokhaiotl/${id}`;
  }

  return '/api/v1';
}

/**
 * Returns the Blert URL to the player page for the given username.
 * @param username Player username.
 * @returns URL for the player's page.
 */
export function playerUrl(username: string): string {
  return `/players/${encodeURIComponent(username)}`;
}

type SingleOrArray<T> = T | T[];
export type UrlParam = SingleOrArray<string | number> | undefined;
export type UrlParams = Record<string, UrlParam>;

export type NextSearchParams = Record<string, string | string[] | undefined>;

/**
 * Returns a URL query string from the given parameters.
 *
 * @param params Key-value pairs to encode. Undefined values are ignored.
 * @param joinMultiple If a value is an array, join its values with commas as a
 *   single URL parameter. If false, each array value is added as a separate
 *   parameter.
 * @returns A URL query string.
 */
export function queryString(
  params: UrlParams,
  joinMultiple: boolean = true,
): string {
  const searchParams = new URLSearchParams();
  for (const [key, valueRaw] of Object.entries(params)) {
    if (valueRaw === undefined) {
      continue;
    }

    let value = valueRaw;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }

      if (!joinMultiple) {
        for (const v of value) {
          searchParams.append(key, v.toString());
        }
        continue;
      }

      value = value.join(',');
    }
    searchParams.set(key, value.toString());
  }
  return searchParams.toString();
}
