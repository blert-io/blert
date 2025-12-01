import { ChallengeType } from '@blert/common';

enum Logos {
  STANDARD = '/images/blert.png',
  CHRISTMAS = '/images/blert-christmas.png',
  HALLOWEEN = '/images/blert-halloween.png',
  TOB = '/images/tob.webp',
  COX = '/images/cox.webp',
  TOA = '/images/toa.webp',
  COLOSSEUM = '/images/colosseum.png',
  INFERNO = '/images/inferno.png',
  MOKHAIOTL = '/images/mokhaiotl.webp',
}

export const MAIN_LOGO = Logos.CHRISTMAS;

/**
 * Returns the logo for the challenge with the given type.
 * @param challengeType Type of challenge.
 * @returns Logo for the challenge.
 */
export function challengeLogo(challengeType: ChallengeType): string {
  switch (challengeType) {
    case ChallengeType.TOB:
      return Logos.TOB;
    case ChallengeType.COX:
      return Logos.COX;
    case ChallengeType.TOA:
      return Logos.TOA;
    case ChallengeType.COLOSSEUM:
      return Logos.COLOSSEUM;
    case ChallengeType.INFERNO:
      return Logos.INFERNO;
    case ChallengeType.MOKHAIOTL:
      return Logos.MOKHAIOTL;
  }
}
