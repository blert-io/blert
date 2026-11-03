/**
 * @jest-environment jsdom
 */
import {
  EventType,
  NpcAttack,
  Stage,
  TfaGuardianShroomsEvent,
  TfaGuardianShroomState,
} from '@blert/common';

import { EnhancedRoomNpc, PlayerStateMap } from '@/utils/boss-room-state';

import { guardianBreaths, shroomsByTick } from '../entities';

describe('shroomsByTick', () => {
  it('tracks each shroom from its spawn until it is removed or the room ends', () => {
    const events: TfaGuardianShroomsEvent[] = [
      {
        type: EventType.TFA_GUARDIAN_SHROOMS as const,
        stage: Stage.TFA_GUARDIAN,
        tick: 29,
        xCoord: 0,
        yCoord: 0,
        tfaGuardianShrooms: {
          updated: [
            {
              id: 1,
              position: { x: 4126, y: 5597 },
              state: TfaGuardianShroomState.SPAWNING,
            },
            {
              id: 4,
              position: { x: 4132, y: 5592 },
              state: TfaGuardianShroomState.SPAWNING,
            },
          ],
          removed: [],
        },
      },
      {
        type: EventType.TFA_GUARDIAN_SHROOMS as const,
        stage: Stage.TFA_GUARDIAN,
        tick: 32,
        xCoord: 0,
        yCoord: 0,
        tfaGuardianShrooms: {
          updated: [
            {
              id: 1,
              position: { x: 4126, y: 5597 },
              state: TfaGuardianShroomState.GROWN,
            },
            {
              id: 4,
              position: { x: 4132, y: 5592 },
              state: TfaGuardianShroomState.GROWN,
            },
          ],
          removed: [],
        },
      },
      {
        type: EventType.TFA_GUARDIAN_SHROOMS as const,
        stage: Stage.TFA_GUARDIAN,
        tick: 39,
        xCoord: 0,
        yCoord: 0,
        tfaGuardianShrooms: {
          updated: [
            {
              id: 1,
              position: { x: 4126, y: 5597 },
              state: TfaGuardianShroomState.POPPED,
            },
          ],
          removed: [],
        },
      },
      {
        type: EventType.TFA_GUARDIAN_SHROOMS as const,
        stage: Stage.TFA_GUARDIAN,
        tick: 41,
        xCoord: 0,
        yCoord: 0,
        tfaGuardianShrooms: { updated: [], removed: [1] },
      },
      {
        type: EventType.TFA_GUARDIAN_SHROOMS as const,
        stage: Stage.TFA_GUARDIAN,
        tick: 189,
        xCoord: 0,
        yCoord: 0,
        tfaGuardianShrooms: { updated: [], removed: [4] },
      },
    ];

    const byTick = shroomsByTick(events, 189);

    expect(byTick.length).toBe(189);
    expect(
      Object.fromEntries(
        [28, 29, 31, 32, 39, 40, 41, 188].map((tick) => [tick, byTick[tick]]),
      ),
    ).toEqual({
      28: [],
      29: [
        {
          id: 1,
          position: { x: 4126, y: 5597 },
          state: TfaGuardianShroomState.SPAWNING,
          ticksInState: 0,
        },
        {
          id: 4,
          position: { x: 4132, y: 5592 },
          state: TfaGuardianShroomState.SPAWNING,
          ticksInState: 0,
        },
      ],
      31: [
        {
          id: 1,
          position: { x: 4126, y: 5597 },
          state: TfaGuardianShroomState.SPAWNING,
          ticksInState: 2,
        },
        {
          id: 4,
          position: { x: 4132, y: 5592 },
          state: TfaGuardianShroomState.SPAWNING,
          ticksInState: 2,
        },
      ],
      32: [
        {
          id: 1,
          position: { x: 4126, y: 5597 },
          state: TfaGuardianShroomState.GROWN,
          ticksInState: 0,
        },
        {
          id: 4,
          position: { x: 4132, y: 5592 },
          state: TfaGuardianShroomState.GROWN,
          ticksInState: 0,
        },
      ],
      39: [
        {
          id: 1,
          position: { x: 4126, y: 5597 },
          state: TfaGuardianShroomState.POPPED,
          ticksInState: 0,
        },
        {
          id: 4,
          position: { x: 4132, y: 5592 },
          state: TfaGuardianShroomState.GROWN,
          ticksInState: 7,
        },
      ],
      40: [
        {
          id: 1,
          position: { x: 4126, y: 5597 },
          state: TfaGuardianShroomState.POPPED,
          ticksInState: 1,
        },
        {
          id: 4,
          position: { x: 4132, y: 5592 },
          state: TfaGuardianShroomState.GROWN,
          ticksInState: 8,
        },
      ],
      41: [
        {
          id: 4,
          position: { x: 4132, y: 5592 },
          state: TfaGuardianShroomState.GROWN,
          ticksInState: 9,
        },
      ],
      188: [
        {
          id: 4,
          position: { x: 4132, y: 5592 },
          state: TfaGuardianShroomState.GROWN,
          ticksInState: 156,
        },
      ],
    });
  });
});

describe('guardianBreaths', () => {
  it('pairs each focus with the breath that lands after it', () => {
    const attacks = new Map([
      [
        341,
        {
          attack: {
            attack: NpcAttack.TFA_GUARDIAN_BREATH_FOCUS,
            target: '715',
          },
        },
      ],
      [
        351,
        { attack: { attack: NpcAttack.TFA_GUARDIAN_BREATH, target: '715' } },
      ],
      [
        361,
        {
          attack: {
            attack: NpcAttack.TFA_GUARDIAN_BREATH_FOCUS,
            target: '1Ogp',
          },
        },
      ],
      [
        371,
        { attack: { attack: NpcAttack.TFA_GUARDIAN_BREATH, target: '1Ogp' } },
      ],
      [
        381,
        {
          attack: {
            attack: NpcAttack.TFA_GUARDIAN_BREATH_FOCUS,
            target: 'Sacolyn',
          },
        },
      ],
    ]);
    const guardian = {
      roomId: 37602,
      dyingTick: 386,
      stateByTick: Array.from(
        { length: 393 },
        (_, tick) => attacks.get(tick) ?? null,
      ),
    } as unknown as EnhancedRoomNpc;
    const playerState = new Map([
      [
        '715',
        {
          stateByTick: Array.from({ length: 393 }, (_, tick) =>
            tick === 351 ? { xCoord: 4130, yCoord: 5583 } : null,
          ),
        },
      ],
      [
        '1Ogp',
        {
          stateByTick: Array.from({ length: 393 }, (_, tick) =>
            tick === 371 ? { xCoord: 4127, yCoord: 5590 } : null,
          ),
        },
      ],
      [
        'Sacolyn',
        {
          stateByTick: Array.from({ length: 393 }, (_, tick) =>
            tick === 381 ? { xCoord: 4129, yCoord: 5590 } : null,
          ),
        },
      ],
    ]) as unknown as PlayerStateMap;

    expect(guardianBreaths(guardian, playerState, 393)).toEqual([
      {
        focusTick: 341,
        focusEndTick: 351,
        target: '715',
        tile: { x: 4130, y: 5583 },
      },
      {
        focusTick: 361,
        focusEndTick: 371,
        target: '1Ogp',
        tile: { x: 4127, y: 5590 },
      },
      { focusTick: 381, focusEndTick: 386, target: 'Sacolyn', tile: null },
    ]);
  });
});
