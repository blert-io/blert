import { ChallengeMode, ChallengeType, SplitType, Stage } from '@blert/common';

import { parseChallengeQueryParams } from '@/api/v1/challenges/query';

function parse(params: Record<string, string>) {
  return parseChallengeQueryParams(new URLSearchParams(params));
}

describe('parseChallengeQuery', () => {
  it('should return an empty query for no params', () => {
    const query = parse({});
    expect(query).not.toBeNull();
    expect(query!.splits!.size).toBe(0);
    expect(query!.customConditions).toEqual([]);
  });

  describe('party', () => {
    it('should parse a single player', () => {
      const query = parse({ party: 'WWWWWWWWWWQQ' });
      expect(query!.party).toEqual(['WWWWWWWWWWQQ']);
    });

    it('should parse multiple players', () => {
      const query = parse({ party: 'Caps lock13,Yieldofin' });
      expect(query!.party).toEqual(['Caps lock13', 'Yieldofin']);
    });
  });

  describe('mode', () => {
    it('should parse a single mode', () => {
      const query = parse({ mode: String(ChallengeMode.TOB_REGULAR) });
      expect(query!.mode).toEqual([ChallengeMode.TOB_REGULAR]);
    });

    it('should parse multiple modes', () => {
      const query = parse({
        mode: `${ChallengeMode.TOB_REGULAR},${ChallengeMode.TOB_HARD}`,
      });
      expect(query!.mode).toEqual([
        ChallengeMode.TOB_REGULAR,
        ChallengeMode.TOB_HARD,
      ]);
    });

    it('should filter out non-numeric modes', () => {
      const query = parse({ mode: `${ChallengeMode.TOB_REGULAR},abc` });
      expect(query!.mode).toEqual([ChallengeMode.TOB_REGULAR]);
    });
  });

  describe('sort', () => {
    it('should parse a descending sort', () => {
      const query = parse({ sort: '-startTime' });
      expect(query!.sort).toEqual(['-startTime#nl']);
    });

    it('should parse an ascending sort', () => {
      const query = parse({ sort: '+challengeTicks' });
      expect(query!.sort).toEqual(['+challengeTicks#nl']);
    });

    it('should parse two sort fields', () => {
      const query = parse({ sort: '-startTime,+id' });
      expect(query!.sort).toHaveLength(2);
    });

    it('should reject more than two sort fields', () => {
      expect(parse({ sort: '-a,+b,-c' })).toBeNull();
    });

    it('should reject sort without direction prefix', () => {
      expect(parse({ sort: 'startTime' })).toBeNull();
    });

    it('should reverse sort direction with before param', () => {
      const query = parse({ sort: '-startTime', before: '100' });
      expect(query!.sort).toEqual(['+startTime#nf']);
    });
  });

  describe('pagination', () => {
    it('should reject both before and after', () => {
      expect(
        parse({ sort: '-startTime', before: '100', after: '200' }),
      ).toBeNull();
    });
  });

  describe('comparator params', () => {
    it('should parse type', () => {
      const query = parse({ type: String(ChallengeType.TOB) });
      expect(query!.type).toEqual(['==', ChallengeType.TOB]);
    });

    it('should parse scale', () => {
      const query = parse({ scale: 'ge4' });
      expect(query!.scale).toEqual(['>=', 4]);
    });

    it('should parse status as a list', () => {
      const query = parse({ status: '1,2' });
      expect(query!.status).toEqual(['in', [1, 2]]);
    });

    it('should parse challengeTicks', () => {
      const query = parse({ challengeTicks: 'lt1000' });
      expect(query!.challengeTicks).toEqual(['<', 1000]);
    });

    it('should parse stage', () => {
      const query = parse({ stage: String(Stage.TOB_BLOAT) });
      expect(query!.stage).toEqual(['==', Stage.TOB_BLOAT]);
    });

    it('should parse startTime as a date comparator', () => {
      const timestamp = Date.now();
      const query = parse({ startTime: `ge${timestamp}` });
      expect(query).not.toBeNull();
      expect(query!.startTime![0]).toBe('>=');
    });

    it('should reject invalid comparator values', () => {
      expect(parse({ type: 'invalid' })).toBeNull();
    });
  });

  describe('split params', () => {
    it('should parse split comparators', () => {
      const query = parse({ 'split:28': 'le600' });
      expect(query).not.toBeNull();
      expect(query!.splits!.get(SplitType.TOB_REG_BLOAT)).toEqual(['<=', 600]);
    });

    it('should parse multiple splits', () => {
      const query = parse({ 'split:28': 'le600', 'split:7': 'lt300' });
      expect(query!.splits!.size).toBe(2);
      expect(query!.splits!.get(28)).toEqual(['<=', 600]);
      expect(query!.splits!.get(7)).toEqual(['<', 300]);
    });

    it('should reject non-numeric split type', () => {
      expect(parse({ 'split:abc': 'le600' })).toBeNull();
    });

    it('should reject invalid comparator value', () => {
      expect(parse({ 'split:28': 'invalid' })).toBeNull();
    });
  });

  describe('tob.bloatDown params', () => {
    it('should parse a single down walk time filter', () => {
      const query = parse({ 'tob.bloatDown:1': 'le39' });
      expect(query).not.toBeNull();
      expect(query!.tob!.bloatDowns!.get(1)).toEqual(['<=', 39]);
    });

    it('should parse multiple down walk time filters', () => {
      const query = parse({
        'tob.bloatDown:1': 'eq41',
        'tob.bloatDown:2': 'le42',
      });
      expect(query).not.toBeNull();
      expect(query!.tob!.bloatDowns!.get(1)).toEqual(['==', 41]);
      expect(query!.tob!.bloatDowns!.get(2)).toEqual(['<=', 42]);
    });

    it('should reject down number < 1', () => {
      expect(parse({ 'tob.bloatDown:0': 'le39' })).toBeNull();
      expect(parse({ 'tob.bloatDown:-10': 'le39' })).toBeNull();
    });

    it('should reject non-numeric down number', () => {
      expect(parse({ 'tob.bloatDown:abc': 'le39' })).toBeNull();
    });

    it('should reject invalid comparator value', () => {
      expect(parse({ 'tob.bloatDown:1': 'invalid' })).toBeNull();
    });
  });

  describe('tob.bloatDownCount param', () => {
    it('should parse a down count comparator', () => {
      const query = parse({ 'tob.bloatDownCount': 'eq3' });
      expect(query).not.toBeNull();
      expect(query!.tob!.bloatDownCount).toEqual(['==', 3]);
    });

    it('should parse a range down count', () => {
      const query = parse({ 'tob.bloatDownCount': '2..5' });
      expect(query).not.toBeNull();
      expect(query!.tob!.bloatDownCount).toEqual(['range', [2, 5]]);
    });
  });

  describe('tob stat params', () => {
    it('should parse nylocas pre-cap stalls', () => {
      const query = parse({ 'tob.nylocasPreCapStalls': 'eq0' });
      expect(query!.tob!.nylocasPreCapStalls).toEqual(['==', 0]);
    });

    it('should parse nylocas post-cap stalls', () => {
      const query = parse({ 'tob.nylocasPostCapStalls': 'le2' });
      expect(query!.tob!.nylocasPostCapStalls).toEqual(['<=', 2]);
    });

    it('should parse verzik reds count', () => {
      const query = parse({ 'tob.verzikRedsCount': 'ge2' });
      expect(query!.tob!.verzikRedsCount).toEqual(['>=', 2]);
    });

    it('should parse multiple tob stat filters together', () => {
      const query = parse({
        'tob.bloatDownCount': 'eq3',
        'tob.nylocasPreCapStalls': 'eq0',
        'tob.verzikRedsCount': 'ge2',
      });
      expect(query!.tob!.bloatDownCount).toEqual(['==', 3]);
      expect(query!.tob!.nylocasPreCapStalls).toEqual(['==', 0]);
      expect(query!.tob!.verzikRedsCount).toEqual(['>=', 2]);
    });

    it('should reject invalid stat comparator value', () => {
      expect(parse({ 'tob.verzikRedsCount': 'invalid' })).toBeNull();
    });
  });

  describe('mokhaiotl stat params', () => {
    it('should parse max completed delve', () => {
      const query = parse({ 'mok.maxCompletedDelve': 'ge40' });
      expect(query!.mokhaiotl!.maxCompletedDelve).toEqual(['>=', 40]);
    });

    it('should parse range max completed delve', () => {
      const query = parse({ 'mok.maxCompletedDelve': '30..50' });
      expect(query!.mokhaiotl!.maxCompletedDelve).toEqual(['range', [30, 50]]);
    });

    it('should leave mokhaiotl undefined when no mok params', () => {
      const query = parse({});
      expect(query!.mokhaiotl).toBeUndefined();
    });

    it('should reject invalid max completed delve value', () => {
      expect(parse({ 'mok.maxCompletedDelve': 'invalid' })).toBeNull();
    });
  });

  describe('unknown namespaced params', () => {
    it('should ignore unknown namespaces', () => {
      const query = parse({ 'unknown:1': 'eq5' });
      expect(query).not.toBeNull();
      expect(query!.splits!.size).toBe(0);
      expect(query!.tob).toBeUndefined();
    });
  });

  describe('combined params', () => {
    it('should parse a complex query', () => {
      const query = parse({
        party: 'WWWWWWWWWWQQ',
        mode: String(ChallengeMode.TOB_REGULAR),
        type: String(ChallengeType.TOB),
        'split:28': 'le600',
        'tob.bloatDown:1': 'eq41',
        'tob.bloatDownCount': 'eq3',
        sort: '-startTime',
      });
      expect(query).not.toBeNull();
      expect(query!.party).toEqual(['WWWWWWWWWWQQ']);
      expect(query!.mode).toEqual([ChallengeMode.TOB_REGULAR]);
      expect(query!.type).toEqual(['==', ChallengeType.TOB]);
      expect(query!.splits!.get(28)).toEqual(['<=', 600]);
      expect(query!.tob!.bloatDowns!.get(1)).toEqual(['==', 41]);
      expect(query!.tob!.bloatDownCount).toEqual(['==', 3]);
      expect(query!.sort).toEqual(['-startTime#nl']);
    });
  });
});
