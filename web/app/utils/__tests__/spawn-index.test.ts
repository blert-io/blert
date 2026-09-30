import { ChallengeType, NpcId, Stage } from '@blert/common';

import {
  decodeLosToolUrl,
  decodePlayerTile,
  decodeSpawn,
  encodeLosToolUrl,
  encodePlayerTile,
  encodeSpawn,
  encodeTile,
  spawnQueryParam,
} from '../spawn-index';

describe('decodeSpawn', () => {
  it('decodes a Colosseum shaman', () => {
    expect(decodeSpawn(Stage.COLOSSEUM_WAVE_1, 784)).toEqual({
      npcId: NpcId.SERPENT_SHAMAN,
      x: 1832,
      y: 3107,
    });
  });

  it('decodes a Colosseum javelin colossus', () => {
    expect(decodeSpawn(Stage.COLOSSEUM_WAVE_2, 1939)).toEqual({
      npcId: NpcId.JAVELIN_COLOSSUS,
      x: 1836,
      y: 3104,
    });
  });

  it('decodes an Inferno meleer', () => {
    expect(decodeSpawn(Stage.INFERNO_WAVE_42, 2757)).toEqual({
      npcId: NpcId.JAL_IMKOT,
      x: 2279,
      y: 5353,
    });
  });

  it('returns null for a stage with no arena', () => {
    expect(decodeSpawn(Stage.TOB_MAIDEN, 784)).toBeNull();
  });
});

describe('encodeSpawn', () => {
  const SHAMAN = { type: ChallengeType.COLOSSEUM, value: 784 };
  const MELEER = { type: ChallengeType.INFERNO, value: 2757 };

  it('encodes a Colosseum shaman', () => {
    expect(
      encodeSpawn({ npcId: NpcId.SERPENT_SHAMAN, x: 1832, y: 3107 }),
    ).toEqual(SHAMAN);
  });

  it('encodes an Inferno meleer', () => {
    expect(encodeSpawn({ npcId: NpcId.JAL_IMKOT, x: 2279, y: 5353 })).toEqual(
      MELEER,
    );
  });

  it('encodes a tile local to the LoS tool grid', () => {
    expect(encodeSpawn({ npcId: NpcId.SERPENT_SHAMAN, x: 24, y: 16 })).toEqual(
      SHAMAN,
    );
  });

  it('returns null for an NPC which spawns in no arena', () => {
    expect(
      encodeSpawn({ npcId: NpcId.SOL_HEREDIT, x: 1832, y: 3107 }),
    ).toBeNull();
  });

  it('returns null for a tile in the wrong arena', () => {
    expect(
      encodeSpawn({ npcId: NpcId.SERPENT_SHAMAN, x: 2279, y: 5353 }),
    ).toBeNull();
  });

  it('accepts an NPC alias', () => {
    expect(encodeSpawn({ npcId: 'meleer', x: 2279, y: 5353 })).toEqual(MELEER);
    expect(encodeSpawn({ npcId: 'jal-imkot', x: 2279, y: 5353 })).toEqual(
      MELEER,
    );
  });

  it('accepts an NPC ID as a token', () => {
    expect(encodeSpawn({ npcId: '12811', x: 24, y: 16 })).toEqual(SHAMAN);
  });

  it('returns null for an unknown token', () => {
    expect(encodeSpawn({ npcId: 'jaguar', x: 24, y: 16 })).toBeNull();
    expect(encodeSpawn({ npcId: '12809', x: 24, y: 16 })).toBeNull();
  });
});

describe('decodePlayerTile', () => {
  it('decodes a Colosseum tile', () => {
    expect(decodePlayerTile(Stage.COLOSSEUM_WAVE_1, 2826)).toEqual({
      x: 1818,
      y: 3112,
    });
  });

  it('decodes an Inferno tile', () => {
    expect(decodePlayerTile(Stage.INFERNO_WAVE_42, 1296)).toEqual({
      x: 2273,
      y: 5353,
    });
  });

  it('returns null for a stage with no arena', () => {
    expect(decodePlayerTile(Stage.TOB_MAIDEN, 2826)).toBeNull();
  });
});

describe('encodePlayerTile', () => {
  it('encodes a Colosseum tile', () => {
    expect(encodePlayerTile({ x: 1818, y: 3112 })).toEqual({
      type: ChallengeType.COLOSSEUM,
      value: 2826,
    });
  });

  it('encodes an Inferno tile', () => {
    expect(encodePlayerTile({ x: 2273, y: 5353 })).toEqual({
      type: ChallengeType.INFERNO,
      value: 1296,
    });
  });

  it('encodes a tile local to the LoS tool grid', () => {
    expect(encodePlayerTile({ x: 10, y: 11 })).toEqual({
      type: null,
      value: 2826,
    });
  });
});

describe('encodeTile', () => {
  it('lists a value per Colosseum NPC type', () => {
    expect(encodeTile(ChallengeType.COLOSSEUM, { x: 1832, y: 3107 })).toEqual([
      784, 1808, 2832, 3856,
    ]);
  });

  it('lists a value per Inferno NPC type', () => {
    expect(encodeTile(ChallengeType.INFERNO, { x: 2279, y: 5353 })).toEqual([
      709, 1733, 2757, 3781, 4805,
    ]);
  });

  it('accepts a tile local to the LoS tool grid', () => {
    expect(encodeTile(ChallengeType.COLOSSEUM, { x: 24, y: 16 })).toEqual([
      784, 1808, 2832, 3856,
    ]);
  });

  it('returns null for a tile nothing spawns on', () => {
    expect(
      encodeTile(ChallengeType.COLOSSEUM, { x: 1808, y: 3123 }),
    ).toBeNull();
  });

  it('returns null for a challenge with no arena', () => {
    expect(encodeTile(ChallengeType.TOB, { x: 1832, y: 3107 })).toBeNull();
  });
});

describe('decodeLosToolUrl', () => {
  it('decodes a colosim link, ignoring the player position', () => {
    expect(
      decodeLosToolUrl('https://los.colosim.com/?13141.28144m.#3847'),
    ).toEqual({
      type: ChallengeType.COLOSSEUM,
      npcs: [
        { npcId: NpcId.SERPENT_SHAMAN, x: 1821, y: 3109 },
        { npcId: NpcId.MANTICORE, x: 1836, y: 3109 },
      ],
    });
  });

  it('decodes an ifreedive link, ignoring pillar and nibbler options', () => {
    expect(
      decodeLosToolUrl(
        'https://ifreedive-osrs.github.io/?01285.03117..noWe.degeN',
      ),
    ).toEqual({
      type: ChallengeType.INFERNO,
      npcs: [
        { npcId: NpcId.JAL_IMKOT, x: 2258, y: 5330 },
        { npcId: NpcId.JAL_ZEK, x: 2260, y: 5347 },
      ],
    });
  });

  it('skips NPCs which are not part of a spawn', () => {
    expect(decodeLosToolUrl('https://los.colosim.com/?17213.16246.')).toEqual({
      type: ChallengeType.COLOSSEUM,
      npcs: [{ npcId: NpcId.SHOCKWAVE_COLOSSUS, x: 1824, y: 3099 }],
    });
  });

  it('skips tiles outside of the arena grid', () => {
    expect(
      decodeLosToolUrl('https://ifreedive-osrs.github.io/?40055.23127.'),
    ).toEqual({
      type: ChallengeType.INFERNO,
      npcs: [{ npcId: NpcId.JAL_ZEK, x: 2280, y: 5346 }],
    });
  });

  it.each([
    ['a link to another site', 'https://colosseum.example.com/?17091.'],
    ['a string which is not a URL', 'los.colosim.com/?17091.'],
  ])('returns null for %s', (_label, link) => {
    expect(decodeLosToolUrl(link)).toBeNull();
  });
});

describe('encodeLosToolUrl', () => {
  it('builds a colosim link with NPCs and a player', () => {
    expect(
      encodeLosToolUrl({
        type: ChallengeType.COLOSSEUM,
        npcs: [
          { npcId: NpcId.SERPENT_SHAMAN, x: 1832, y: 3107 },
          { npcId: NpcId.MANTICORE, x: 1827, y: 3103 },
        ],
        player: { x: 1815, y: 3110 },
      }),
    ).toBe('https://los.colosim.com/?24161.19204.#3335');
  });

  it('builds an ifreedive link with NPCs but not a player', () => {
    expect(
      encodeLosToolUrl({
        type: ChallengeType.INFERNO,
        npcs: [
          { npcId: NpcId.JAL_IMKOT, x: 2258, y: 5353 },
          { npcId: NpcId.JAL_ZEK, x: 2280, y: 5333 },
        ],
        player: { x: 2274, y: 5355 },
      }),
    ).toBe('https://ifreedive-osrs.github.io/?01055.23257.');
  });

  it('returns null for a challenge with no LoS tool', () => {
    expect(
      encodeLosToolUrl({ type: ChallengeType.TOB, npcs: [], player: null }),
    ).toBeNull();
  });
});

describe('spawnQueryParam', () => {
  it('builds a Colosseum spawn', () => {
    expect(
      spawnQueryParam(Stage.COLOSSEUM_WAVE_5, [
        { npcId: NpcId.SERPENT_SHAMAN, x: 1825, y: 3114 },
        { npcId: NpcId.JAVELIN_COLOSSUS, x: 1832, y: 3107 },
        { npcId: NpcId.MANTICORE, x: 1827, y: 3109 },
      ]),
    ).toBe(
      'stage:104;npc:shaman@1825.3114;npc:javelin-colossus@1832.3107;' +
        'npc:manticore@1827.3109',
    );
  });

  it('builds an Inferno spawn', () => {
    expect(
      spawnQueryParam(Stage.INFERNO_WAVE_15, [
        { npcId: NpcId.JAL_AK, x: 2258, y: 5353 },
        { npcId: NpcId.JAL_AK, x: 2260, y: 5347 },
        { npcId: NpcId.JAL_IMKOT, x: 2279, y: 5353 },
      ]),
    ).toBe(
      'stage:214;npc:blob@2258.5353;npc:blob@2260.5347;npc:meleer@2279.5353',
    );
  });
});
