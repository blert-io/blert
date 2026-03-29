import { ChallengeType, Stage } from '@blert/common';

import {
  challengeApiUrl,
  challengeUrl,
  npcImageUrl,
  stagePath,
  validateRedirectUrl,
} from '../url';

describe('validateRedirectUrl', () => {
  it('returns "/" for undefined', () => {
    expect(validateRedirectUrl(undefined)).toBe('/');
  });

  it('allows valid relative paths', () => {
    expect(validateRedirectUrl('/')).toBe('/');
    expect(validateRedirectUrl('/login')).toBe('/login');
    expect(validateRedirectUrl('/raids/tob/123')).toBe('/raids/tob/123');
    expect(validateRedirectUrl('/path?query=value')).toBe('/path?query=value');
    expect(validateRedirectUrl('/path#anchor')).toBe('/path#anchor');
  });

  it('rejects protocol-relative URLs', () => {
    expect(validateRedirectUrl('//evil.com')).toBe('/');
    expect(validateRedirectUrl('//evil.com/path')).toBe('/');
  });

  it('rejects absolute URLs with protocols', () => {
    expect(validateRedirectUrl('https://evil.com')).toBe('/');
    expect(validateRedirectUrl('http://evil.com')).toBe('/');
    expect(validateRedirectUrl('https://evil.com/path')).toBe('/');
  });

  it('rejects javascript: URLs', () => {
    expect(validateRedirectUrl('javascript:alert(1)')).toBe('/');
  });

  it('rejects data: URLs', () => {
    expect(
      validateRedirectUrl('data:text/html,<script>alert(1)</script>'),
    ).toBe('/');
  });

  it('rejects paths not starting with /', () => {
    expect(validateRedirectUrl('path/to/page')).toBe('/');
    expect(validateRedirectUrl('evil.com/path')).toBe('/');
  });

  it('rejects empty string', () => {
    expect(validateRedirectUrl('')).toBe('/');
  });

  it('rejects backslash URLs (browser normalization bypass)', () => {
    expect(validateRedirectUrl('/\\evil.com')).toBe('/');
    expect(validateRedirectUrl('/\\\\evil.com')).toBe('/');
  });
});

describe('challengeUrl', () => {
  it('returns raid URLs for raid types', () => {
    expect(challengeUrl(ChallengeType.TOB, 'abc')).toBe('/raids/tob/abc');
    expect(challengeUrl(ChallengeType.COX, 'abc')).toBe('/raids/cox/abc');
    expect(challengeUrl(ChallengeType.TOA, 'abc')).toBe('/raids/toa/abc');
  });

  it('returns challenge URLs for non-raid types', () => {
    expect(challengeUrl(ChallengeType.COLOSSEUM, 'abc')).toBe(
      '/challenges/colosseum/abc',
    );
    expect(challengeUrl(ChallengeType.INFERNO, 'abc')).toBe(
      '/challenges/inferno/abc',
    );
    expect(challengeUrl(ChallengeType.MOKHAIOTL, 'abc')).toBe(
      '/challenges/mokhaiotl/abc',
    );
  });
});

describe('challengeApiUrl', () => {
  it('returns API URLs for raid types', () => {
    expect(challengeApiUrl(ChallengeType.TOB, 'abc')).toBe(
      '/api/v1/raids/tob/abc',
    );
    expect(challengeApiUrl(ChallengeType.COX, 'abc')).toBe(
      '/api/v1/raids/cox/abc',
    );
    expect(challengeApiUrl(ChallengeType.TOA, 'abc')).toBe(
      '/api/v1/raids/toa/abc',
    );
  });

  it('returns API URLs for non-raid types', () => {
    expect(challengeApiUrl(ChallengeType.COLOSSEUM, 'abc')).toBe(
      '/api/v1/challenges/colosseum/abc',
    );
    expect(challengeApiUrl(ChallengeType.INFERNO, 'abc')).toBe(
      '/api/v1/challenges/inferno/abc',
    );
    expect(challengeApiUrl(ChallengeType.MOKHAIOTL, 'abc')).toBe(
      '/api/v1/challenges/mokhaiotl/abc',
    );
  });
});

describe('stagePath', () => {
  it('returns "overview" for unknown stage', () => {
    expect(stagePath(Stage.UNKNOWN)).toBe('overview');
  });

  it('returns boss name for TOB stages', () => {
    expect(stagePath(Stage.TOB_MAIDEN)).toBe('maiden');
    expect(stagePath(Stage.TOB_BLOAT)).toBe('bloat');
    expect(stagePath(Stage.TOB_NYLOCAS)).toBe('nylocas');
    expect(stagePath(Stage.TOB_SOTETSEG)).toBe('sotetseg');
    expect(stagePath(Stage.TOB_XARPUS)).toBe('xarpus');
    expect(stagePath(Stage.TOB_VERZIK)).toBe('verzik');
  });

  it('returns room name for COX stages', () => {
    expect(stagePath(Stage.COX_TEKTON)).toBe('tekton');
    expect(stagePath(Stage.COX_CRABS)).toBe('crabs');
    expect(stagePath(Stage.COX_ICE_DEMON)).toBe('ice-demon');
    expect(stagePath(Stage.COX_SHAMANS)).toBe('shamans');
    expect(stagePath(Stage.COX_VANGUARDS)).toBe('vanguards');
    expect(stagePath(Stage.COX_THIEVING)).toBe('thieving');
    expect(stagePath(Stage.COX_VESPULA)).toBe('vespula');
    expect(stagePath(Stage.COX_TIGHTROPE)).toBe('tightrope');
    expect(stagePath(Stage.COX_GUARDIANS)).toBe('guardians');
    expect(stagePath(Stage.COX_VASA)).toBe('vasa');
    expect(stagePath(Stage.COX_MYSTICS)).toBe('mystics');
    expect(stagePath(Stage.COX_MUTTADILE)).toBe('muttadile');
    expect(stagePath(Stage.COX_OLM)).toBe('olm');
  });

  it('returns room name for TOA stages', () => {
    expect(stagePath(Stage.TOA_APMEKEN)).toBe('apmeken');
    expect(stagePath(Stage.TOA_BABA)).toBe('baba');
    expect(stagePath(Stage.TOA_SCABARAS)).toBe('scabaras');
    expect(stagePath(Stage.TOA_KEPHRI)).toBe('kephri');
    expect(stagePath(Stage.TOA_HET)).toBe('het');
    expect(stagePath(Stage.TOA_AKKHA)).toBe('akkha');
    expect(stagePath(Stage.TOA_CRONDIS)).toBe('crondis');
    expect(stagePath(Stage.TOA_ZEBAK)).toBe('zebak');
    expect(stagePath(Stage.TOA_WARDENS)).toBe('wardens');
  });

  it('returns wave path for colosseum stages', () => {
    expect(stagePath(Stage.COLOSSEUM_WAVE_1)).toBe('waves/1');
    expect(stagePath(Stage.COLOSSEUM_WAVE_6)).toBe('waves/6');
    expect(stagePath(Stage.COLOSSEUM_WAVE_12)).toBe('waves/12');
  });

  it('returns wave path for inferno stages', () => {
    expect(stagePath(Stage.INFERNO_WAVE_1)).toBe('waves/1');
    expect(stagePath(Stage.INFERNO_WAVE_35)).toBe('waves/35');
    expect(stagePath(Stage.INFERNO_WAVE_69)).toBe('waves/69');
  });

  it('returns delve path for mokhaiotl stages', () => {
    expect(stagePath(Stage.MOKHAIOTL_DELVE_1)).toBe('delves/1');
    expect(stagePath(Stage.MOKHAIOTL_DELVE_4)).toBe('delves/4');
    expect(stagePath(Stage.MOKHAIOTL_DELVE_7)).toBe('delves/7');
  });

  it('returns delve path with attempt offset for mokhaiotl 8+', () => {
    expect(stagePath(Stage.MOKHAIOTL_DELVE_8PLUS)).toBe('delves/8');
    expect(stagePath(Stage.MOKHAIOTL_DELVE_8PLUS, 0)).toBe('delves/8');
    expect(stagePath(Stage.MOKHAIOTL_DELVE_8PLUS, 1)).toBe('delves/9');
    expect(stagePath(Stage.MOKHAIOTL_DELVE_8PLUS, 5)).toBe('delves/13');
  });
});

describe('npcImageUrl', () => {
  it('returns fallback image for unknown NPC IDs', () => {
    expect(npcImageUrl(999999)).toBe('/images/huh.png');
    expect(npcImageUrl(-1)).toBe('/images/huh.png');
    expect(npcImageUrl(0)).toBe('/images/huh.png');
  });

  it('uses canonicalId for NPCs with semanticId: false', () => {
    expect(npcImageUrl(7691)).toBe('/images/npcs/7691.webp');
    expect(npcImageUrl(10814)).toBe('/images/npcs/8360.webp');
  });

  it('uses npcId for NPCs with semanticId: true', () => {
    expect(npcImageUrl(10804)).toBe('/images/npcs/10804.webp');
    expect(npcImageUrl(10805)).toBe('/images/npcs/10805.webp');
    expect(npcImageUrl(10806)).toBe('/images/npcs/10806.webp');
  });
});
