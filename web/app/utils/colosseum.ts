import { Handicap, handicapBase } from '@blert/common';

const HANDICAP_SLUGS: Record<number, string> = {
  [Handicap.MANTIMAYHEM]: 'mantimayhem',
  [Handicap.REENTRY]: 'reentry',
  [Handicap.BEES]: 'bees',
  [Handicap.VOLATILITY]: 'volatility',
  [Handicap.BLASPHEMY]: 'blasphemy',
  [Handicap.RELENTLESS]: 'relentless',
  [Handicap.QUARTET]: 'quartet',
  [Handicap.TOTEMIC]: 'totemic',
  [Handicap.DOOM]: 'doom',
  [Handicap.DYNAMIC_DUO]: 'dynamicDuo',
  [Handicap.SOLARFLARE]: 'solarflare',
  [Handicap.MYOPIA]: 'myopia',
  [Handicap.FRAILTY]: 'frailty',
  [Handicap.RED_FLAG]: 'redFlag',
};

const HANDICAP_BY_SLUG: Record<string, Handicap> = Object.fromEntries(
  Object.entries(HANDICAP_SLUGS).map(([id, slug]) => [
    slug,
    Number(id) as Handicap,
  ]),
);

/** Returns the API slug for a handicap, or `null` if unknown. */
export function handicapSlug(handicap: Handicap): string | null {
  return HANDICAP_SLUGS[handicapBase(handicap)] ?? null;
}

/** Resolves an API slug to its base handicap, or `null` if unrecognized. */
export function handicapFromSlug(slug: string): Handicap | null {
  return HANDICAP_BY_SLUG[slug] ?? null;
}

/**
 * Resolves an API token representing a handicap by either base ID or slug to a
 * `Handicap`, or null if unrecognized. Leveled synthetic IDs are rejected.
 */
export function handicapFromToken(token: string): Handicap | null {
  const fromSlug = handicapFromSlug(token);
  if (fromSlug !== null) {
    return fromSlug;
  }
  if (/^\d+$/.test(token) && HANDICAP_SLUGS[Number(token)] !== undefined) {
    return Number(token) as Handicap;
  }
  return null;
}
