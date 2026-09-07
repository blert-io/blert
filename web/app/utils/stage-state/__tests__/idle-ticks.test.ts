import {
  DataSource,
  Event,
  EventType,
  PlayerAttackEvent,
  PlayerDeathEvent,
  PlayerUpdateEvent,
} from '@blert/common';

import { buildEventMaps } from '../event-maps';
import { IdleTickCount, computeIdleTickCounts } from '../idle-ticks';
import { computePlayerState } from '../player-state';

function playerUpdate(
  tick: number,
  name: string,
  offCooldownTick: number,
): PlayerUpdateEvent {
  return {
    tick,
    type: EventType.PLAYER_UPDATE as const,
    stage: 0,
    xCoord: 0,
    yCoord: 0,
    acc: true,
    player: {
      source: DataSource.PRIMARY,
      name,
      offCooldownTick,
      prayerSet: 0,
    },
  };
}

function playerAttack(tick: number, name: string): PlayerAttackEvent {
  return {
    tick,
    type: EventType.PLAYER_ATTACK as const,
    stage: 0,
    xCoord: 0,
    yCoord: 0,
    player: { name },
    attack: { type: 1, distanceToTarget: 0 },
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

function idleTicksFor(
  party: string[],
  totalTicks: number,
  events: Event[],
): Map<string, IdleTickCount> {
  const [eventsByTick, eventsByType] = buildEventMaps(events);
  const playerState = computePlayerState(
    party,
    totalTicks,
    eventsByTick,
    eventsByType,
  );
  return computeIdleTickCounts(playerState);
}

describe('computeIdleTickCounts', () => {
  // A 4-tick weapon attack on ticks 3 and 9.
  const attackEvents = (name: string): Event[] => [
    playerUpdate(0, name, 0),
    playerUpdate(1, name, 0),
    playerUpdate(2, name, 0),
    playerUpdate(3, name, 7),
    playerAttack(3, name),
    playerUpdate(4, name, 7),
    playerUpdate(5, name, 7),
    playerUpdate(6, name, 7),
    playerUpdate(7, name, 7),
    playerUpdate(8, name, 7),
    playerUpdate(9, name, 13),
    playerAttack(9, name),
    playerUpdate(10, name, 13),
    playerUpdate(11, name, 13),
  ];

  it('counts off cooldown ticks between the first and final attacks', () => {
    const counts = idleTicksFor(['1Ogp'], 12, attackEvents('1Ogp'));
    // First attack on tick 3, ticks 7-8 are idle between the attacks.
    expect(counts.get('1Ogp')).toEqual({
      idleTicks: 2,
      eligibleTicks: 7,
      longestIdle: 2,
      idlePeriods: 1,
    });
  });

  it('excludes ticks after the final attack', () => {
    // Remove the tick 9 attack, leaving only the attack on tick 3. Ticks 7-8
    // are off cooldown but aren't counted without later attacks.
    const events = attackEvents('1Ogp').filter(
      (event) => !(event.type === EventType.PLAYER_ATTACK && event.tick === 9),
    );
    const counts = idleTicksFor(['1Ogp'], 12, events);
    expect(counts.get('1Ogp')).toEqual({
      idleTicks: 0,
      eligibleTicks: 1,
      longestIdle: 0,
      idlePeriods: 0,
    });
  });

  it('counts every eligible tick for a player who never attacks', () => {
    const events: Event[] = [];
    for (let tick = 0; tick < 6; tick++) {
      events.push(playerUpdate(tick, '1Ogp', 0));
    }
    const counts = idleTicksFor(['1Ogp'], 6, events);

    expect(counts.get('1Ogp')).toEqual({
      idleTicks: 5,
      eligibleTicks: 5,
      longestIdle: 5,
      idlePeriods: 1,
    });
  });

  it('stops counting when the player dies', () => {
    const events: Event[] = [];
    for (let tick = 0; tick <= 4; tick++) {
      events.push(playerUpdate(tick, '1Ogp', 0));
    }
    events.push(playerDeath(4, '1Ogp'));

    const counts = idleTicksFor(['1Ogp'], 10, events);

    // Ticks 1-3 are idle. Tick 4 is the death tick.
    expect(counts.get('1Ogp')).toEqual({
      idleTicks: 3,
      eligibleTicks: 3,
      longestIdle: 3,
      idlePeriods: 1,
    });
  });

  it('skips ticks without player state', () => {
    const events: Event[] = [
      playerUpdate(0, '1Ogp', 0),
      playerUpdate(1, '1Ogp', 2),
      playerAttack(1, '1Ogp'),
      playerUpdate(2, '1Ogp', 2),
      playerUpdate(4, '1Ogp', 2),
      playerUpdate(5, '1Ogp', 9),
      playerAttack(5, '1Ogp'),
    ];
    const counts = idleTicksFor(['1Ogp'], 6, events);

    // Tick 3 has no events for 1Ogp, so it is neither idle nor eligible, and
    // it splits the surrounding idle ticks into separate periods.
    expect(counts.get('1Ogp')).toEqual({
      idleTicks: 2,
      eligibleTicks: 4,
      longestIdle: 1,
      idlePeriods: 2,
    });
  });

  it('computes counts independently per player', () => {
    const events: Event[] = [
      playerUpdate(0, '1Ogp', 0),
      playerUpdate(1, '1Ogp', 3),
      playerAttack(1, '1Ogp'),
      playerUpdate(2, '1Ogp', 3),
      playerUpdate(3, '1Ogp', 3),
      playerUpdate(4, '1Ogp', 7),
      playerAttack(4, '1Ogp'),
      playerUpdate(5, '1Ogp', 7),
    ];
    for (let tick = 0; tick < 6; tick++) {
      events.push(playerUpdate(tick, 'WWWWWWWWWWQQ', 0));
    }

    const counts = idleTicksFor(['1Ogp', 'WWWWWWWWWWQQ'], 6, events);

    expect(counts.size).toBe(2);
    expect(counts.get('1Ogp')).toEqual({
      idleTicks: 1,
      eligibleTicks: 4,
      longestIdle: 1,
      idlePeriods: 1,
    });
    expect(counts.get('WWWWWWWWWWQQ')).toEqual({
      idleTicks: 5,
      eligibleTicks: 5,
      longestIdle: 5,
      idlePeriods: 1,
    });
  });

  it('tracks runs of unequal length', () => {
    const events: Event[] = [
      playerUpdate(0, '1Ogp', 0),
      playerUpdate(1, '1Ogp', 3),
      playerAttack(1, '1Ogp'),
      playerUpdate(2, '1Ogp', 3),
      playerUpdate(3, '1Ogp', 3),
      playerUpdate(4, '1Ogp', 6),
      playerAttack(4, '1Ogp'),
      playerUpdate(5, '1Ogp', 6),
      playerUpdate(6, '1Ogp', 6),
      playerUpdate(7, '1Ogp', 6),
      playerUpdate(8, '1Ogp', 6),
      playerUpdate(9, '1Ogp', 11),
      playerAttack(9, '1Ogp'),
    ];
    const counts = idleTicksFor(['1Ogp'], 10, events);

    // Idle on 3 and 6-8
    expect(counts.get('1Ogp')).toEqual({
      idleTicks: 4,
      eligibleTicks: 9,
      longestIdle: 3,
      idlePeriods: 2,
    });
  });
});
