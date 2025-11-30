import {
  DataSource,
  EquipmentSlot,
  NpcAttack,
  PlayerAttack,
  Prayer,
  PrayerBook,
  PrayerSet,
} from '@blert/common';

import {
  createNpcAttackEvent,
  createNpcDeathEvent,
  createNpcSpawnEvent,
  createPlayerDeathEvent,
  createPlayerState,
  createTickState,
} from './fixtures';
import { SimilarityScorer } from '../similarity-scorer';

describe('SimilarityScorer', () => {
  describe('consistency checks', () => {
    it('returns a finite score when overlapping players match', () => {
      const player1 = createPlayerState({
        username: 'player1',
        source: DataSource.PRIMARY,
        x: 10,
        y: 20,
        equipment: {
          [EquipmentSlot.WEAPON]: { id: 100, quantity: 1 },
        },
      });
      const player2 = createPlayerState({ username: 'player2', x: 15, y: 30 });

      const base = createTickState(5, [player1, player2]);
      const target = createTickState(5, [
        createPlayerState({
          username: 'player1',
          source: DataSource.PRIMARY,
          x: 10,
          y: 20,
          equipment: {
            [EquipmentSlot.WEAPON]: { id: 100, quantity: 1 },
          },
        }),
        // player2 missing from target; should be ignored rather than penalized.
      ]);

      const score = new SimilarityScorer().score(base, target);
      expect(Number.isFinite(score)).toBe(true);
    });

    it('returns -Infinity when player positions differ', () => {
      const base = createTickState(1, [
        createPlayerState({ username: 'player1', x: 5, y: 5 }),
      ]);
      const target = createTickState(1, [
        createPlayerState({ username: 'player1', x: 6, y: 5 }),
      ]);

      expect(new SimilarityScorer().score(base, target)).toBe(-Infinity);
    });

    it('returns -Infinity when player gear differs in a visible slot', () => {
      const base = createTickState(2, [
        createPlayerState({
          username: 'player1',
          x: 5,
          y: 5,
          equipment: {
            [EquipmentSlot.HEAD]: { id: 200, quantity: 1 },
          },
        }),
      ]);
      const target = createTickState(2, [
        createPlayerState({
          username: 'player1',
          x: 5,
          y: 5,
          equipment: {
            [EquipmentSlot.HEAD]: { id: 201, quantity: 1 },
          },
        }),
      ]);

      expect(new SimilarityScorer().score(base, target)).toBe(-Infinity);
    });

    it('returns a finite score when overlapping NPCs match positions', () => {
      const npcEvent = createNpcSpawnEvent({
        tick: 3,
        roomId: 1,
        npcId: 200,
        x: 100,
        y: 200,
        hitpointsCurrent: 500,
      });

      const base = createTickState(
        3,
        [createPlayerState({ username: 'player1' })],
        [npcEvent],
      );
      const target = createTickState(
        3,
        [createPlayerState({ username: 'player1' })],
        [npcEvent.clone()],
      );

      expect(Number.isFinite(new SimilarityScorer().score(base, target))).toBe(
        true,
      );
    });

    it('returns -Infinity when overlapping NPC positions differ', () => {
      const base = createTickState(
        4,
        [createPlayerState({ username: 'player1' })],
        [
          createNpcSpawnEvent({
            tick: 4,
            roomId: 10,
            npcId: 300,
            x: 200,
            y: 300,
            hitpointsCurrent: 600,
          }),
        ],
      );
      const target = createTickState(
        4,
        [createPlayerState({ username: 'player1' })],
        [
          createNpcSpawnEvent({
            tick: 4,
            roomId: 10,
            npcId: 300,
            x: 201,
            y: 300,
            hitpointsCurrent: 600,
          }),
        ],
      );

      expect(new SimilarityScorer().score(base, target)).toBe(-Infinity);
    });

    it('returns -Infinity when overlapping NPC IDs differ', () => {
      const base = createTickState(
        4,
        [createPlayerState({ username: 'player1' })],
        [
          createNpcSpawnEvent({
            tick: 4,
            roomId: 10,
            npcId: 100,
            x: 200,
            y: 300,
            hitpointsCurrent: 600,
          }),
        ],
      );
      const target = createTickState(
        4,
        [createPlayerState({ username: 'player1' })],
        [
          createNpcSpawnEvent({
            tick: 4,
            roomId: 10,
            npcId: 101,
            x: 200,
            y: 300,
            hitpointsCurrent: 600,
          }),
        ],
      );

      expect(new SimilarityScorer().score(base, target)).toBe(-Infinity);
    });
  });

  describe('hitpoints scoring', () => {
    it('scores positively when NPC hitpoints match exactly', () => {
      const npcEvent = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 500,
        hitpointsBase: 500,
      });

      const base = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcEvent],
      );
      const target = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcEvent.clone()],
      );

      const score = new SimilarityScorer().score(base, target);
      expect(score).toBeGreaterThan(0);
    });

    it('scores lower when NPC hitpoints differ slightly', () => {
      const baseNpc = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 500,
        hitpointsBase: 500,
      });
      const targetNpc = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 475,
        hitpointsBase: 500,
      });

      const base = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [baseNpc],
      );
      const target = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [targetNpc],
      );

      // Compare to exact match
      const exactBase = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [baseNpc],
      );
      const exactTarget = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [baseNpc.clone()],
      );

      const diffScore = new SimilarityScorer().score(base, target);
      const exactScore = new SimilarityScorer().score(exactBase, exactTarget);

      expect(diffScore).toBeLessThan(exactScore);
      expect(diffScore).toBeGreaterThan(0);
    });

    it('ignores NPCs with large hitpoint differences', () => {
      const baseNpc = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 500,
        hitpointsBase: 500,
      });
      const targetNpc = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 250,
        hitpointsBase: 500,
      });

      const base = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [baseNpc],
      );
      const target = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [targetNpc],
      );

      const score = new SimilarityScorer().score(base, target);
      expect(score).toBe(0);
    });
  });

  describe('player attack scoring', () => {
    it('scores positively when same player attacks same target', () => {
      const npcEvent = createNpcSpawnEvent({
        tick: 1,
        roomId: 5,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 500,
      });

      const basePlayer = createPlayerState({
        username: 'player1',
        attack: {
          type: PlayerAttack.SCYTHE_UNCHARGED,
          weaponId: 22325,
          target: 5,
        },
      });
      const targetPlayer = createPlayerState({
        username: 'player1',
        attack: {
          type: PlayerAttack.SCYTHE_UNCHARGED,
          weaponId: 22325,
          target: 5,
        },
      });

      const base = createTickState(1, [basePlayer], [npcEvent]);
      const target = createTickState(1, [targetPlayer], [npcEvent.clone()]);

      const score = new SimilarityScorer().score(base, target);
      expect(score).toBeGreaterThan(0);
    });

    it('penalizes when same player attacks with different weapon', () => {
      const npcEvent = createNpcSpawnEvent({
        tick: 1,
        roomId: 5,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 500,
      });

      const basePlayer = createPlayerState({
        username: 'player1',
        attack: {
          type: PlayerAttack.SCYTHE_UNCHARGED,
          weaponId: 22325,
          target: 5,
        },
      });
      const targetPlayer = createPlayerState({
        username: 'player1',
        attack: {
          type: PlayerAttack.BLOWPIPE,
          weaponId: 12926,
          target: 5,
        },
      });

      const base = createTickState(1, [basePlayer], [npcEvent]);
      const target = createTickState(1, [targetPlayer], [npcEvent.clone()]);

      const mismatchScore = new SimilarityScorer().score(base, target);

      const noAttackBase = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcEvent],
      );
      const noAttackTarget = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcEvent.clone()],
      );
      const noAttackScore = new SimilarityScorer().score(
        noAttackBase,
        noAttackTarget,
      );

      expect(mismatchScore).toBeLessThan(noAttackScore);
    });

    it('applies weak negative when attack missing from one state', () => {
      const npcEvent = createNpcSpawnEvent({
        tick: 1,
        roomId: 5,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 500,
      });

      const attackingPlayer = createPlayerState({
        username: 'player1',
        attack: {
          type: PlayerAttack.SCYTHE_UNCHARGED,
          weaponId: 22325,
          target: 5,
        },
      });
      const nonAttackingPlayer = createPlayerState({ username: 'player1' });

      const base = createTickState(1, [attackingPlayer], [npcEvent]);
      const target = createTickState(
        1,
        [nonAttackingPlayer],
        [npcEvent.clone()],
      );

      const noAttackBase = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcEvent],
      );
      const noAttackTarget = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcEvent.clone()],
      );

      const missingScore = new SimilarityScorer().score(base, target);
      const noAttackScore = new SimilarityScorer().score(
        noAttackBase,
        noAttackTarget,
      );

      expect(missingScore).toBeLessThan(noAttackScore);
    });
  });

  describe('NPC attack scoring', () => {
    it('scores positively when same NPC attacks same target', () => {
      const npcSpawn = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 8360,
        x: 10,
        y: 10,
        hitpointsCurrent: 3500,
      });
      const npcAttack = createNpcAttackEvent({
        tick: 1,
        roomId: 1,
        npcId: 8360,
        attackType: NpcAttack.TOB_MAIDEN_AUTO,
        target: 'player1',
      });

      const base = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcSpawn, npcAttack],
      );
      const target = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcSpawn.clone(), npcAttack.clone()],
      );

      const score = new SimilarityScorer().score(base, target);
      expect(score).toBeGreaterThan(0);
    });

    it('penalizes when same NPC attacks different target', () => {
      const npcSpawn = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 8360,
        x: 10,
        y: 10,
        hitpointsCurrent: 3500,
      });
      const baseAttack = createNpcAttackEvent({
        tick: 1,
        roomId: 1,
        npcId: 8360,
        attackType: NpcAttack.TOB_MAIDEN_AUTO,
        target: 'player1',
      });
      const targetAttack = createNpcAttackEvent({
        tick: 1,
        roomId: 1,
        npcId: 8360,
        attackType: NpcAttack.TOB_MAIDEN_AUTO,
        target: 'player2',
      });

      const base = createTickState(
        1,
        [
          createPlayerState({ username: 'player1' }),
          createPlayerState({ username: 'player2', x: 5 }),
        ],
        [npcSpawn, baseAttack],
      );
      const target = createTickState(
        1,
        [
          createPlayerState({ username: 'player1' }),
          createPlayerState({ username: 'player2', x: 5 }),
        ],
        [npcSpawn.clone(), targetAttack],
      );

      const noAttackBase = createTickState(
        1,
        [
          createPlayerState({ username: 'player1' }),
          createPlayerState({ username: 'player2', x: 5 }),
        ],
        [npcSpawn],
      );
      const noAttackTarget = createTickState(
        1,
        [
          createPlayerState({ username: 'player1' }),
          createPlayerState({ username: 'player2', x: 5 }),
        ],
        [npcSpawn.clone()],
      );

      const mismatchScore = new SimilarityScorer().score(base, target);
      const noAttackScore = new SimilarityScorer().score(
        noAttackBase,
        noAttackTarget,
      );

      expect(mismatchScore).toBeLessThan(noAttackScore);
    });
  });

  describe('prayer scoring', () => {
    it('scores positively when overhead prayers match', () => {
      const basePlayer = createPlayerState({
        username: 'player1',
        prayers: PrayerSet.fromPrayers(PrayerBook.NORMAL, [
          Prayer.PROTECT_FROM_MAGIC,
          Prayer.RIGOUR,
        ]),
      });
      const targetPlayer = createPlayerState({
        username: 'player1',
        prayers: PrayerSet.fromPrayers(PrayerBook.NORMAL, [
          Prayer.PROTECT_FROM_MAGIC,
          Prayer.PIETY,
        ]),
      });

      const base = createTickState(1, [basePlayer]);
      const target = createTickState(1, [targetPlayer]);

      const score = new SimilarityScorer().score(base, target);
      expect(score).toBeGreaterThan(0);
    });

    it('scores negatively when overhead prayers differ', () => {
      const basePlayer = createPlayerState({
        username: 'player1',
        prayers: PrayerSet.fromPrayers(PrayerBook.NORMAL, [
          Prayer.PROTECT_FROM_MAGIC,
        ]),
      });
      const targetPlayer = createPlayerState({
        username: 'player1',
        prayers: PrayerSet.fromPrayers(PrayerBook.NORMAL, [
          Prayer.PROTECT_FROM_MISSILES,
        ]),
      });

      const base = createTickState(1, [basePlayer]);
      const target = createTickState(1, [targetPlayer]);

      const matchBase = createTickState(1, [basePlayer]);
      const matchTarget = createTickState(1, [
        createPlayerState({
          username: 'player1',
          prayers: PrayerSet.fromPrayers(PrayerBook.NORMAL, [
            Prayer.PROTECT_FROM_MAGIC,
          ]),
        }),
      ]);

      const diffScore = new SimilarityScorer().score(base, target);
      const matchScore = new SimilarityScorer().score(matchBase, matchTarget);

      expect(diffScore).toBeLessThan(matchScore);
    });

    it('ignores overheads when both are empty', () => {
      const basePlayer = createPlayerState({
        username: 'player1',
        prayers: PrayerSet.fromPrayers(PrayerBook.NORMAL, [Prayer.RIGOUR]),
      });
      const targetPlayer = createPlayerState({
        username: 'player1',
        prayers: PrayerSet.fromPrayers(PrayerBook.NORMAL, [Prayer.PIETY]),
      });

      const base = createTickState(1, [basePlayer]);
      const target = createTickState(1, [targetPlayer]);

      const score = new SimilarityScorer().score(base, target);
      expect(score).toBe(0);
    });
  });

  describe('death scoring', () => {
    it('scores positively when both states have same player death', () => {
      const deathEvent = createPlayerDeathEvent({ tick: 1, name: 'player1' });

      const base = createTickState(
        1,
        [createPlayerState({ username: 'player1', isDead: true })],
        [deathEvent],
      );
      const target = createTickState(
        1,
        [createPlayerState({ username: 'player1', isDead: true })],
        [deathEvent.clone()],
      );

      const noDeathBase = createTickState(1, [
        createPlayerState({ username: 'player1' }),
      ]);
      const noDeathTarget = createTickState(1, [
        createPlayerState({ username: 'player1' }),
      ]);

      const deathScore = new SimilarityScorer().score(base, target);
      const noDeathScore = new SimilarityScorer().score(
        noDeathBase,
        noDeathTarget,
      );

      expect(deathScore).toBeGreaterThan(noDeathScore);
    });

    it('does not penalize when player death in only one state', () => {
      const deathEvent = createPlayerDeathEvent({ tick: 1, name: 'player1' });

      const base = createTickState(
        1,
        [createPlayerState({ username: 'player1', isDead: true })],
        [deathEvent],
      );
      const target = createTickState(1, [
        createPlayerState({ username: 'player1' }),
      ]);

      const noDeathBase = createTickState(1, [
        createPlayerState({ username: 'player1' }),
      ]);
      const noDeathTarget = createTickState(1, [
        createPlayerState({ username: 'player1' }),
      ]);

      const mismatchScore = new SimilarityScorer().score(base, target);
      const noDeathScore = new SimilarityScorer().score(
        noDeathBase,
        noDeathTarget,
      );

      expect(mismatchScore).toEqual(noDeathScore);
    });

    it('scores positively when both states have same NPC death', () => {
      const npcSpawn = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 0,
        hitpointsBase: 500,
      });
      const npcDeath = createNpcDeathEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
      });

      const base = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcSpawn, npcDeath],
      );
      const target = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcSpawn.clone(), npcDeath.clone()],
      );

      const noDeathSpawn = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 500,
      });
      const noDeathBase = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [noDeathSpawn],
      );
      const noDeathTarget = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [noDeathSpawn.clone()],
      );

      const deathScore = new SimilarityScorer().score(base, target);
      const noDeathScore = new SimilarityScorer().score(
        noDeathBase,
        noDeathTarget,
      );

      expect(deathScore).toBeGreaterThan(noDeathScore);
    });

    it('penalizes when NPC death in only one state but NPC visible in both', () => {
      const npcSpawn = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 0,
        hitpointsBase: 500,
      });
      const npcDeath = createNpcDeathEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
      });

      const base = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcSpawn, npcDeath],
      );
      const target = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [npcSpawn.clone()],
      );

      const noDeathSpawn = createNpcSpawnEvent({
        tick: 1,
        roomId: 1,
        npcId: 100,
        x: 10,
        y: 10,
        hitpointsCurrent: 500,
      });
      const noDeathBase = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [noDeathSpawn],
      );
      const noDeathTarget = createTickState(
        1,
        [createPlayerState({ username: 'player1' })],
        [noDeathSpawn.clone()],
      );

      const mismatchScore = new SimilarityScorer().score(base, target);
      const noDeathScore = new SimilarityScorer().score(
        noDeathBase,
        noDeathTarget,
      );

      expect(mismatchScore).toBeLessThan(noDeathScore);
    });
  });
});
