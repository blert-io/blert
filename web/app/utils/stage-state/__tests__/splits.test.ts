import {
  Event,
  EventType,
  MaidenCrabSpawn,
  MaidenCrabPosition,
  Maze,
  NpcId,
  SplitType,
  VerzikPhase,
  XarpusPhase,
  NpcSpawnEvent,
} from '@blert/common';

import { SplitTracker } from '../splits';

function baseEvent(type: EventType, tick: number): Event {
  return { type, stage: 0, tick, xCoord: 0, yCoord: 0 } as Event;
}

function npcSpawn(tick: number, npcId: number, roomId: number): NpcSpawnEvent {
  return {
    type: EventType.NPC_SPAWN as const,
    stage: 0,
    tick,
    xCoord: 0,
    yCoord: 0,
    npc: { id: npcId, roomId, hitpoints: 0, prayers: 0 },
  };
}

function maidenCrabSpawn(
  tick: number,
  spawn: MaidenCrabSpawn,
  roomId: number,
): NpcSpawnEvent {
  const spawnEvent = npcSpawn(tick, NpcId.MAIDEN_MATOMENOS_REGULAR, roomId);
  return {
    ...spawnEvent,
    npc: {
      ...spawnEvent.npc,
      maidenCrab: { spawn, position: MaidenCrabPosition.S1, scuffed: false },
    },
  };
}

describe('SplitTracker', () => {
  describe('maiden', () => {
    it('detects 70s crab spawn', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        maidenCrabSpawn(21, MaidenCrabSpawn.SEVENTIES, 1),
      ]);
      expect(tracker.splits[SplitType.TOB_MAIDEN_70S]).toBe(21);
    });

    it('detects 50s crab spawn', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([maidenCrabSpawn(42, MaidenCrabSpawn.FIFTIES, 2)]);
      expect(tracker.splits[SplitType.TOB_MAIDEN_50S]).toBe(42);
    });

    it('detects 30s crab spawn', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([maidenCrabSpawn(63, MaidenCrabSpawn.THIRTIES, 3)]);
      expect(tracker.splits[SplitType.TOB_MAIDEN_30S]).toBe(63);
    });

    it('ignores maiden crab subtype on NPC_UPDATE', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          type: EventType.NPC_UPDATE,
          stage: 0,
          tick: 99,
          xCoord: 0,
          yCoord: 0,
          npc: {
            id: 8366,
            roomId: 1,
            hitpoints: 0,
            prayers: 0,
            maidenCrab: {
              spawn: MaidenCrabSpawn.SEVENTIES,
              position: MaidenCrabPosition.S1,
              scuffed: false,
            },
          },
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_MAIDEN_70S]).toBeUndefined();
    });
  });

  describe('nylocas', () => {
    it('detects wave 20 as cap increase', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          ...baseEvent(EventType.TOB_NYLO_WAVE_SPAWN, 50),
          nyloWave: { wave: 20, nylosAlive: 10, roomCap: 24 },
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_NYLO_CAP]).toBe(50);
    });

    it('detects wave 31 as last wave', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          ...baseEvent(EventType.TOB_NYLO_WAVE_SPAWN, 80),
          nyloWave: { wave: 31, nylosAlive: 8, roomCap: 24 },
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_NYLO_WAVES]).toBe(80);
    });

    it('ignores other waves', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          ...baseEvent(EventType.TOB_NYLO_WAVE_SPAWN, 10),
          nyloWave: { wave: 5, nylosAlive: 4, roomCap: 12 },
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_NYLO_CAP]).toBeUndefined();
      expect(tracker.splits[SplitType.TOB_NYLO_WAVES]).toBeUndefined();
    });

    it('detects cleanup end', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([baseEvent(EventType.TOB_NYLO_CLEANUP_END, 90)]);
      expect(tracker.splits[SplitType.TOB_NYLO_CLEANUP]).toBe(90);
    });

    it('detects boss spawn', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([baseEvent(EventType.TOB_NYLO_BOSS_SPAWN, 95)]);
      expect(tracker.splits[SplitType.TOB_NYLO_BOSS_SPAWN]).toBe(95);
    });
  });

  describe('sotetseg', () => {
    it('detects 66% maze proc', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          ...baseEvent(EventType.TOB_SOTE_MAZE_PROC, 40),
          soteMaze: { maze: Maze.MAZE_66 },
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_SOTETSEG_66]).toBe(40);
    });

    it('detects 33% maze proc', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          ...baseEvent(EventType.TOB_SOTE_MAZE_PROC, 80),
          soteMaze: { maze: Maze.MAZE_33 },
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_SOTETSEG_33]).toBe(80);
    });
  });

  describe('xarpus', () => {
    it('detects exhumes end', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          ...baseEvent(EventType.TOB_XARPUS_PHASE, 25),
          xarpusPhase: XarpusPhase.P2,
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_XARPUS_EXHUMES]).toBe(25);
    });

    it('detects screech', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          ...baseEvent(EventType.TOB_XARPUS_PHASE, 60),
          xarpusPhase: XarpusPhase.P3,
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_XARPUS_SCREECH]).toBe(60);
    });

    it('ignores P1 phase event', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          ...baseEvent(EventType.TOB_XARPUS_PHASE, 1),
          xarpusPhase: XarpusPhase.P1,
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_XARPUS_EXHUMES]).toBeUndefined();
      expect(tracker.splits[SplitType.TOB_XARPUS_SCREECH]).toBeUndefined();
    });
  });

  describe('verzik', () => {
    it('detects P1 end', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          ...baseEvent(EventType.TOB_VERZIK_PHASE, 20),
          verzikPhase: VerzikPhase.P2,
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_VERZIK_P1_END]).toBe(20);
    });

    it('detects P2 end', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        {
          ...baseEvent(EventType.TOB_VERZIK_PHASE, 70),
          verzikPhase: VerzikPhase.P3,
        } as Event,
      ]);
      expect(tracker.splits[SplitType.TOB_VERZIK_P2_END]).toBe(70);
    });

    it('records first red crab spawn only', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        npcSpawn(45, NpcId.VERZIK_MATOMENOS_REGULAR, 10),
        npcSpawn(45, NpcId.VERZIK_MATOMENOS_REGULAR, 11),
      ]);
      tracker.processEvents([npcSpawn(60, NpcId.VERZIK_MATOMENOS_REGULAR, 12)]);
      expect(tracker.splits[SplitType.TOB_VERZIK_REDS]).toBe(45);
    });
  });

  describe('lifecycle', () => {
    it('clears and reprocesses on rebuild', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([baseEvent(EventType.TOB_NYLO_BOSS_SPAWN, 95)]);
      expect(tracker.splits[SplitType.TOB_NYLO_BOSS_SPAWN]).toBe(95);

      tracker.rebuild([baseEvent(EventType.TOB_NYLO_CLEANUP_END, 90)]);
      expect(tracker.splits[SplitType.TOB_NYLO_BOSS_SPAWN]).toBeUndefined();
      expect(tracker.splits[SplitType.TOB_NYLO_CLEANUP]).toBe(90);
    });

    it('removes all splits on clear', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([
        baseEvent(EventType.TOB_NYLO_BOSS_SPAWN, 95),
        baseEvent(EventType.TOB_NYLO_CLEANUP_END, 90),
      ]);
      tracker.clear();
      expect(tracker.splits).toEqual({});
    });

    it('ignores tick 0', () => {
      const tracker = new SplitTracker();
      tracker.processEvents([baseEvent(EventType.TOB_NYLO_BOSS_SPAWN, 0)]);
      expect(tracker.splits[SplitType.TOB_NYLO_BOSS_SPAWN]).toBeUndefined();
    });
  });
});
