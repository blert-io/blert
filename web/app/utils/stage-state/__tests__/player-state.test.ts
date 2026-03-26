import {
  DataSource,
  EventType,
  PlayerAttackEvent,
  PlayerDeathEvent,
  PlayerUpdateEvent,
  Skill,
  SkillLevel,
} from '@blert/common';

import { buildEventMaps } from '../event-maps';
import { PlayerStateBuilder, computePlayerState } from '../player-state';

function playerUpdate(
  tick: number,
  name: string,
  overrides: Record<string, unknown> = {},
): PlayerUpdateEvent {
  return {
    tick,
    type: EventType.PLAYER_UPDATE as const,
    stage: 0,
    xCoord: tick * 2,
    yCoord: tick * 2 + 1,
    acc: true,
    player: {
      source: DataSource.PRIMARY,
      name,
      offCooldownTick: 0,
      prayerSet: 0,
      ...overrides,
    },
  };
}

function playerDeath(tick: number, name: string): PlayerDeathEvent {
  return {
    tick,
    type: EventType.PLAYER_DEATH as const,
    stage: 0,
    xCoord: 0,
    yCoord: 0,
    player: { name },
  };
}

function playerAttack(tick: number, name: string): PlayerAttackEvent {
  return {
    tick,
    type: EventType.PLAYER_ATTACK as const,
    stage: 0,
    xCoord: 0,
    yCoord: 0,
    player: {
      name,
    },
    attack: { type: 1, distanceToTarget: 0 },
  };
}

describe('computePlayerState', () => {
  it('returns empty map for empty party', () => {
    const result = computePlayerState([], 10, {}, {});
    expect(result.size).toBe(0);
  });

  it('creates null-filled arrays when no events exist', () => {
    const result = computePlayerState(['Alice'], 5, {}, {});
    const state = result.get('Alice')!;
    expect(state).toHaveLength(5);
    expect(state.every((s) => s === null)).toBe(true);
  });

  it('builds state from player update events', () => {
    const events = [playerUpdate(1, 'Alice'), playerUpdate(3, 'Alice')];
    const [byTick, byType] = buildEventMaps(events);
    const result = computePlayerState(['Alice'], 5, byTick, byType);
    const state = result.get('Alice')!;

    expect(state[0]).toBeNull();
    expect(state[1]).not.toBeNull();
    expect(state[1]!.xCoord).toBe(2);
    expect(state[2]).toBeNull();
    expect(state[3]).not.toBeNull();
    expect(state[3]!.xCoord).toBe(6);
  });

  it('tracks death state', () => {
    const events = [
      playerUpdate(0, 'Alice'),
      playerDeath(2, 'Alice'),
      playerUpdate(2, 'Alice'),
    ];
    const [byTick, byType] = buildEventMaps(events);
    const result = computePlayerState(['Alice'], 5, byTick, byType);
    const state = result.get('Alice')!;

    expect(state[0]!.isDead).toBe(false);
    expect(state[2]!.isDead).toBe(true);
    expect(state[2]!.diedThisTick).toBe(true);
    // Dead state persists on subsequent ticks with events.
    expect(state[3]).toBeNull();
  });

  it('tracks skills from player update', () => {
    const events = [
      playerUpdate(0, 'Alice', {
        hitpoints: new SkillLevel(99, 99).toRaw(),
      }),
    ];
    const [byTick, byType] = buildEventMaps(events);
    const result = computePlayerState(['Alice'], 2, byTick, byType);
    const state = result.get('Alice')!;

    expect(state[0]!.skills[Skill.HITPOINTS]?.getCurrent()).toBe(99);
    expect(state[0]!.skills[Skill.HITPOINTS]?.getBase()).toBe(99);
  });

  it('handles multiple players independently', () => {
    const events = [
      playerUpdate(0, 'Alice'),
      playerUpdate(0, 'Bob'),
      playerUpdate(1, 'Alice'),
    ];
    const [byTick, byType] = buildEventMaps(events);
    const result = computePlayerState(['Alice', 'Bob'], 3, byTick, byType);

    expect(result.get('Alice')![1]).not.toBeNull();
    expect(result.get('Bob')![1]).toBeNull();
  });
});

describe('PlayerStateBuilder', () => {
  it('matches full build when appending in chunks', () => {
    const events = [
      playerUpdate(0, 'Alice'),
      playerUpdate(1, 'Bob'),
      playerAttack(1, 'Alice'),
      playerUpdate(2, 'Alice'),
      playerUpdate(3, 'Bob'),
      playerDeath(4, 'Alice'),
      playerUpdate(4, 'Alice'),
    ];
    const [byTick, byType] = buildEventMaps(events);
    const party = ['Alice', 'Bob'];
    const totalTicks = 6;

    const full = computePlayerState(party, totalTicks, byTick, byType);

    const builder = new PlayerStateBuilder();
    builder.extend(party, 2, byTick, byType);
    builder.extend(party, 4, byTick, byType);
    builder.extend(party, totalTicks, byTick, byType);

    for (const name of party) {
      const fullState = full.get(name)!;
      const incState = builder.state.get(name)!;
      expect(incState).toHaveLength(fullState.length);

      for (let tick = 0; tick < totalTicks; tick++) {
        if (fullState[tick] === null) {
          expect(incState[tick]).toBeNull();
        } else {
          expect(incState[tick]).not.toBeNull();
          expect(incState[tick]!.xCoord).toBe(fullState[tick]!.xCoord);
          expect(incState[tick]!.isDead).toBe(fullState[tick]!.isDead);
          expect(incState[tick]!.diedThisTick).toBe(
            fullState[tick]!.diedThisTick,
          );
        }
      }
    }
  });

  it('carries death state across incremental boundaries', () => {
    const events = [
      playerUpdate(0, 'Alice'),
      playerDeath(1, 'Alice'),
      playerUpdate(1, 'Alice'),
    ];
    const [byTick, byType] = buildEventMaps(events);

    const builder = new PlayerStateBuilder();
    builder.extend(['Alice'], 2, byTick, byType);
    builder.extend(['Alice'], 4, byTick, byType);

    const state = builder.state.get('Alice')!;
    expect(state[1]!.isDead).toBe(true);
    expect(state[1]!.diedThisTick).toBe(true);
    expect(state[2]).toBeNull();
    expect(state[3]).toBeNull();
  });

  it('resets all state on clear', () => {
    const events = [playerUpdate(0, 'Alice')];
    const [byTick, byType] = buildEventMaps(events);

    const builder = new PlayerStateBuilder();
    builder.extend(['Alice'], 2, byTick, byType);
    expect(builder.state.size).toBe(1);

    builder.clear();
    expect(builder.state.size).toBe(0);
  });

  it('builds fresh state after clear', () => {
    const events = [playerUpdate(0, 'Alice'), playerUpdate(1, 'Alice')];
    const [byTick, byType] = buildEventMaps(events);

    const builder = new PlayerStateBuilder();
    builder.extend(['Alice'], 1, byTick, byType);
    builder.clear();
    builder.extend(['Alice'], 2, byTick, byType);

    const state = builder.state.get('Alice')!;
    expect(state).toHaveLength(2);
    expect(state[0]).not.toBeNull();
    expect(state[1]).not.toBeNull();
  });
});
