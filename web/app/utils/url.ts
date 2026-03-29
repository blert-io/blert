import {
  ChallengeType,
  ColosseumStage,
  InfernoStage,
  MokhaiotlStage,
  Stage,
  getNpcDefinition,
  isColosseumStage,
  isInfernoStage,
  isMokhaiotlStage,
} from '@blert/common';

/**
 * Validates that a redirect URL is safe for same-site redirects.
 * Only allows relative paths starting with `/` to prevent open redirect attacks.
 *
 * @param url The URL to validate.
 * @returns The validated URL if safe, or `/` as a fallback.
 */
export function validateRedirectUrl(url: string | undefined): string {
  if (url === undefined || url === '') {
    return '/';
  }

  // Must start with exactly one forward slash (relative path).
  // Reject protocol-relative URLs (//), absolute URLs, and other schemes.
  if (!url.startsWith('/') || url.startsWith('//') || url.startsWith('/\\')) {
    return '/';
  }

  return url;
}

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

type NonWaveStage = Exclude<
  Stage,
  ColosseumStage | InfernoStage | MokhaiotlStage
>;

const STAGE_PATHS: Record<NonWaveStage, string> = {
  [Stage.UNKNOWN]: 'overview',
  [Stage.TOB_MAIDEN]: 'maiden',
  [Stage.TOB_BLOAT]: 'bloat',
  [Stage.TOB_NYLOCAS]: 'nylocas',
  [Stage.TOB_SOTETSEG]: 'sotetseg',
  [Stage.TOB_XARPUS]: 'xarpus',
  [Stage.TOB_VERZIK]: 'verzik',
  [Stage.COX_TEKTON]: 'tekton',
  [Stage.COX_CRABS]: 'crabs',
  [Stage.COX_ICE_DEMON]: 'ice-demon',
  [Stage.COX_SHAMANS]: 'shamans',
  [Stage.COX_VANGUARDS]: 'vanguards',
  [Stage.COX_THIEVING]: 'thieving',
  [Stage.COX_VESPULA]: 'vespula',
  [Stage.COX_TIGHTROPE]: 'tightrope',
  [Stage.COX_GUARDIANS]: 'guardians',
  [Stage.COX_VASA]: 'vasa',
  [Stage.COX_MYSTICS]: 'mystics',
  [Stage.COX_MUTTADILE]: 'muttadile',
  [Stage.COX_OLM]: 'olm',
  [Stage.TOA_APMEKEN]: 'apmeken',
  [Stage.TOA_BABA]: 'baba',
  [Stage.TOA_SCABARAS]: 'scabaras',
  [Stage.TOA_KEPHRI]: 'kephri',
  [Stage.TOA_HET]: 'het',
  [Stage.TOA_AKKHA]: 'akkha',
  [Stage.TOA_CRONDIS]: 'crondis',
  [Stage.TOA_ZEBAK]: 'zebak',
  [Stage.TOA_WARDENS]: 'wardens',
};

/**
 * Returns the path segment for a given stage within a challenge URL.
 * @returns The path segment, e.g. `'maiden'`, `'waves/3'`.
 */
export function stagePath(stage: Stage, attempt?: number): string {
  if (isColosseumStage(stage)) {
    return `waves/${stage - Stage.COLOSSEUM_WAVE_1 + 1}`;
  }
  if (isInfernoStage(stage)) {
    return `waves/${stage - Stage.INFERNO_WAVE_1 + 1}`;
  }
  if (isMokhaiotlStage(stage)) {
    if (stage === Stage.MOKHAIOTL_DELVE_8PLUS) {
      return `delves/${(attempt ?? 0) + 8}`;
    }
    const delve = stage - Stage.MOKHAIOTL_DELVE_1 + 1;
    return `delves/${delve}`;
  }

  const s: NonWaveStage = stage;
  return STAGE_PATHS[s] ?? 'overview';
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

/**
 * Returns the image URL to for the given NPC ID.
 * @param npcId NPC ID.
 * @returns URL for the NPC's image.
 */
export function npcImageUrl(npcId: number): string {
  const npcDef = getNpcDefinition(npcId);
  if (npcDef !== null) {
    const imageId = npcDef.semanticId ? npcId : npcDef.canonicalId;
    return `/images/npcs/${imageId}.webp`;
  }
  return '/images/huh.png';
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
