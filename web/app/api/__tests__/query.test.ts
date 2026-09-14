import { ChallengeType } from '@blert/common';

import { InvalidQueryError } from '../../actions/errors';
import { spawnQueryValue } from '../query';

describe('spawnQueryValue', () => {
  it('parses a spawn', () => {
    expect(
      spawnQueryValue(
        'stage:104,105;npc:12811@1821.3103;npc:javelin@28.14;npc:manticore@1827.3103;tile:13.20;player:7.13',
        ChallengeType.COLOSSEUM,
      ),
    ).toEqual([
      {
        stage: ['in', [104, 105]],
        values: [436, 1934, 2676],
        tiles: [[436, 1460, 2484, 3508]],
        player: 3335,
        match: 'contains',
      },
      ChallengeType.COLOSSEUM,
    ]);
  });

  it('parses an exact spawn on a stage', () => {
    expect(
      spawnQueryValue(
        'stage:104;value:436;tile:1821.3103;player:1815.3110;match:exact',
        null,
      ),
    ).toEqual([
      {
        stage: ['==', 104],
        values: [436],
        tiles: [[436, 1460, 2484, 3508]],
        player: 3335,
        match: 'exact',
      },
      ChallengeType.COLOSSEUM,
    ]);
  });

  it('infers a challenge type from its clauses', () => {
    expect(
      spawnQueryValue(
        'npc:bat@2258.5330;tile:2262.5335;player:2267.5347',
        null,
      ),
    ).toEqual([
      {
        stage: null,
        values: [60],
        tiles: [[183, 1207, 2231, 3255, 4279]],
        player: 2826,
        match: 'contains',
      },
      ChallengeType.INFERNO,
    ]);
  });

  it('rejects a clause outside the search type', () => {
    expect(() =>
      spawnQueryValue('npc:bat@1.28', ChallengeType.COLOSSEUM),
    ).toThrow(InvalidQueryError);
  });

  it.each([
    '436',
    'wave:104',
    'npc:jaguar@1821.3103',
    'npc:shaman',
    'value:abc',
    'value:32768',
    'player:70000',
    'match:some',
    'value:436;match:exact',
    'stage:104,105;value:436;match:exact',
    'stage:>=104;value:436;match:exact',
    'tile:13.20',
    'npc:shaman@10.11;npc:bat@1.28',
    'stage:104;npc:bat@1.28',
    'player:1818.3112;npc:bat@1.28',
    'npc:shaman@2258.5330',
  ])('rejects %s', (value) => {
    expect(() => spawnQueryValue(value, null)).toThrow(InvalidQueryError);
  });
});
