import { ChallengeType, NpcId, Stage } from '@blert/common';

import {
  decodePlayerTile,
  decodeSpawn,
  encodePlayerTile,
  encodeSpawn,
  encodeTile,
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

  it('encodes a tile local to the planner grid', () => {
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

  it('encodes a tile local to the planner grid', () => {
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

  it('accepts a tile local to the planner grid', () => {
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
