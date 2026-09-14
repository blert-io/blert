import {
  ChallengeMode,
  ChallengeStatus,
  ChallengeType,
  Handicap,
  SplitType,
  Stage,
} from '@blert/common';

import { InvalidQueryError } from '@/actions/errors';
import { NextSearchParams } from '@/utils/url';

import { parseChallengeQuery } from '../query';

describe('parseChallengeQuery', () => {
  it('parses nothing into an empty query', () => {
    expect(parseChallengeQuery({})).toEqual({
      splits: new Map(),
      customConditions: [],
    });
  });

  it('parses party and mode', () => {
    expect(
      parseChallengeQuery({
        party: 'Caps lock13,Yieldofin',
        mode: `${ChallengeMode.TOB_REGULAR},x,${ChallengeMode.TOB_HARD}`,
      }),
    ).toEqual({
      party: ['Caps lock13', 'Yieldofin'],
      mode: [ChallengeMode.TOB_REGULAR, ChallengeMode.TOB_HARD],
      splits: new Map(),
      customConditions: [],
    });
  });

  it('sorts and pages after a cursor', () => {
    expect(
      parseChallengeQuery({ sort: '+challengeTicks,-deaths', after: '100,2' }),
    ).toEqual({
      splits: new Map(),
      sort: ['+challengeTicks#nl', '-deaths#nl'],
      customConditions: [
        [
          [['challengeTicks', '>', 100], '||', ['challengeTicks', 'is', null]],
          '||',
          [['challengeTicks', '==', 100], '&&', ['deaths', '<', 2]],
        ],
      ],
    });
    expect(
      parseChallengeQuery({ sort: '-tob:xarpusHealing', after: '100' }),
    ).toEqual({
      splits: new Map(),
      sort: ['-tob:xarpusHealing#nl'],
      customConditions: [
        [
          ['tob:xarpusHealing', '<', 100],
          '||',
          ['tob:xarpusHealing', 'is', null],
        ],
      ],
    });
  });

  it('reverse sorts and pages before a cursor', () => {
    expect(
      parseChallengeQuery({ sort: '-tob:xarpusHealing', before: '200' }),
    ).toEqual({
      splits: new Map(),
      sort: ['+tob:xarpusHealing#nf'],
      customConditions: [['tob:xarpusHealing', '>', 200]],
    });
    expect(
      parseChallengeQuery({
        sort: '+challengeTicks,-deaths',
        before: 'null,2',
      }),
    ).toEqual({
      splits: new Map(),
      sort: ['-challengeTicks#nf', '+deaths#nf'],
      customConditions: [
        [
          ['challengeTicks', 'isnot', null],
          '||',
          [['challengeTicks', 'is', null], '&&', ['deaths', '>', 2]],
        ],
      ],
    });
  });

  it('parses namespaced parameters and ignores unknown namespaces', () => {
    expect(
      parseChallengeQuery({
        [`split:${SplitType.TOB_MAIDEN}`]: '<=110',
        'tob.bloatDown:2': 'eq30',
        'colo.handicap:bees': '1,2',
        'colo.handicap:mantimayhem': '<=2',
        [`colo.handicap:${Handicap.DYNAMIC_DUO}`]: '1..3',
        'foo:1': '1',
      }),
    ).toEqual({
      splits: new Map([[SplitType.TOB_MAIDEN, ['<=', 110]]]),
      tob: { bloatDowns: new Map([[2, ['==', 30]]]) },
      colosseum: {
        levels: new Map([
          [Handicap.BEES, ['in', [1, 2]]],
          [Handicap.MANTIMAYHEM, ['<=', 2]],
          [Handicap.DYNAMIC_DUO, ['range', [1, 3]]],
        ]),
      },
      customConditions: [],
    });
  });

  it('parses comparator parameters', () => {
    expect(
      parseChallengeQuery({
        type: `${ChallengeType.TOB},${ChallengeType.COLOSSEUM}`,
        scale: 'ge3',
        status: `!${ChallengeStatus.COMPLETED}`,
        startTime: '>=1700000000000',
        challengeTicks: '..1000',
        stage: `${Stage.TOB_VERZIK}`,
      }),
    ).toEqual({
      splits: new Map(),
      customConditions: [],
      type: ['in', [ChallengeType.TOB, ChallengeType.COLOSSEUM]],
      scale: ['>=', 3],
      status: ['!=', ChallengeStatus.COMPLETED],
      startTime: ['>=', new Date(1700000000000)],
      challengeTicks: ['<', 1000],
      stage: ['==', Stage.TOB_VERZIK],
    });
    expect(parseChallengeQuery({ status: '!1,2' })?.status).toEqual([
      'nin',
      [1, 2],
    ]);
    expect(parseChallengeQuery({ status: 'ne3,4,5' })?.status).toEqual([
      'nin',
      [3, 4, 5],
    ]);
  });

  it('parses ToB and Mokhaiotl scalar parameters', () => {
    expect(
      parseChallengeQuery({
        'tob.bloatDownCount': '2..5',
        'tob.nylocasPreCapStalls': '2',
        'tob.nylocasPostCapStalls': '0',
        'tob.xarpusHealing': '>100',
        'tob.verzikRedsCount': '<5',
        'mok.maxCompletedDelve': '30..50',
      }),
    ).toEqual({
      splits: new Map(),
      customConditions: [],
      tob: {
        bloatDownCount: ['range', [2, 5]],
        nylocasPreCapStalls: ['==', 2],
        nylocasPostCapStalls: ['==', 0],
        xarpusHealing: ['>', 100],
        verzikRedsCount: ['<', 5],
      },
      mokhaiotl: { maxCompletedDelve: ['range', [30, 50]] },
    });
  });

  it('parses handicap tokens', () => {
    const base = { splits: new Map(), customConditions: [] };
    expect(parseChallengeQuery({ 'colo.handicap': 'bees' })).toEqual({
      ...base,
      colosseum: { has: ['==', Handicap.BEES] },
    });
    expect(
      parseChallengeQuery({ 'colo.handicap': String(Handicap.DOOM) }),
    ).toEqual({ ...base, colosseum: { has: ['==', Handicap.DOOM] } });
    expect(parseChallengeQuery({ 'colo.handicap': '!bees' })).toEqual({
      ...base,
      colosseum: { has: ['!=', Handicap.BEES] },
    });
    expect(parseChallengeQuery({ 'colo.handicap': 'bees,3' })).toEqual({
      ...base,
      colosseum: { has: ['in', [Handicap.BEES, Handicap.VOLATILITY]] },
    });
    expect(parseChallengeQuery({ 'colo.handicap': '!bees,quartet' })).toEqual({
      ...base,
      colosseum: { has: ['nin', [Handicap.BEES, Handicap.QUARTET]] },
    });
    expect(
      parseChallengeQuery({
        'colo.handicap': 'bees',
        [`colo.handicap:${Handicap.QUARTET}`]: 'ge2',
      }),
    ).toEqual({
      ...base,
      colosseum: {
        has: ['==', Handicap.BEES],
        levels: new Map([[Handicap.QUARTET, ['>=', 2]]]),
      },
    });
  });

  it('parses a custom query', () => {
    expect(parseChallengeQuery({ q: btoa('challengeTicks > 100') })).toEqual({
      splits: new Map(),
      customConditions: [['challengeTicks', '>', 100]],
    });
  });

  const SHAMAN = {
    stage: null,
    values: [331],
    tiles: [],
    player: null,
    match: 'contains',
  };

  it('infers a challenge type from spawns', () => {
    expect(
      parseChallengeQuery({ spawn: ['npc:shaman@10.11', 'player:1818.3112'] }),
    ).toEqual({
      splits: new Map(),
      customConditions: [],
      type: ['==', ChallengeType.COLOSSEUM],
      spawns: [SHAMAN, { ...SHAMAN, values: [], player: 2826 }],
    });
  });

  it('narrows a provided challenge type by spawn', () => {
    expect(parseChallengeQuery({ spawn: 'npc:shaman@10.11' })).toEqual({
      splits: new Map(),
      customConditions: [],
      type: ['==', ChallengeType.COLOSSEUM],
      spawns: [SHAMAN],
    });
    expect(
      parseChallengeQuery({
        type: `${ChallengeType.COLOSSEUM},${ChallengeType.INFERNO}`,
        spawn: 'npc:shaman@10.11',
      })?.type,
    ).toEqual(['==', ChallengeType.COLOSSEUM]);
  });

  it.each<NextSearchParams>([
    { party: ['WWWWWWWWWWQQ', 'WWWWWWWWWWQQ'] },
    { scale: 'x' },
    { before: '1', after: '1' },
    { sort: 'challengeTicks' },
    { sort: '+challengeTicks,-deaths,+startTime' },
    { sort: '+challengeTicks', after: '1,2' },
    { sort: '+challengeTicks', after: 'x' },
    { sort: '+challengeTicks,-deaths', after: '1,x' },
    { 'split:1': ['1', '2'] },
    { 'split:': '1' },
    { 'split:x': '1' },
    { 'split:1': 'abc' },
    { 'tob.bloatDown:0': '1' },
    { 'tob.bloatDown:-10': '1' },
    { 'colo.handicap:jaguar': '1' },
    { 'colo.handicap:99': '1' },
    { 'colo.handicap:bees': '4' },
    { 'colo.handicap:bees': '-1' },
    { 'colo.handicap:bees': 'three' },
    { 'colo.handicap': 'jaguar' },
    { 'colo.handicap': `bees,${Handicap.BEES_2}` },
    { 'colo.handicap': '1..3' },
    { 'colo.handicap': '>=2' },
    { type: `${ChallengeType.TOB}`, spawn: 'npc:shaman@10.11' },
    {
      type: `${ChallengeType.TOB},${ChallengeType.INFERNO}`,
      spawn: 'npc:shaman@10.11',
    },
    { spawn: ['npc:shaman@10.11', 'player:2267.5347'] },
    { q: btoa('()') },
    { q: btoa('challengeTicks >') },
    { q: 'not base64!' },
  ])('rejects %j', (params) => {
    expect(() => parseChallengeQuery(params)).toThrow(InvalidQueryError);
  });
});
