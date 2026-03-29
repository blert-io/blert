import {
  Event,
  EventType,
  MaidenCrabSpawn,
  Maze,
  Npc,
  SplitType,
  VerzikPhase,
  XarpusPhase,
} from '@blert/common';

type Splits = Partial<Record<SplitType, number>>;

/**
 * Detects in-fight splits from an event stream.
 */
export class SplitTracker {
  private map: Splits = {};
  private changed = false;

  get splits(): Readonly<Splits> {
    return this.map;
  }

  processEvents(events: Event[]): boolean {
    this.changed = false;

    for (const event of events) {
      switch (event.type) {
        case EventType.NPC_SPAWN:
          if (event.npc.maidenCrab !== undefined) {
            switch (event.npc.maidenCrab.spawn) {
              case MaidenCrabSpawn.SEVENTIES:
                this.set(SplitType.TOB_MAIDEN_70S, event.tick);
                break;
              case MaidenCrabSpawn.FIFTIES:
                this.set(SplitType.TOB_MAIDEN_50S, event.tick);
                break;
              case MaidenCrabSpawn.THIRTIES:
                this.set(SplitType.TOB_MAIDEN_30S, event.tick);
                break;
            }
          }
          if (Npc.isVerzikMatomenos(event.npc.id)) {
            if (this.map[SplitType.TOB_VERZIK_REDS] === undefined) {
              this.set(SplitType.TOB_VERZIK_REDS, event.tick);
            }
          }
          break;

        case EventType.TOB_NYLO_WAVE_SPAWN:
          if (event.nyloWave.wave === 20) {
            this.set(SplitType.TOB_NYLO_CAP, event.tick);
          } else if (event.nyloWave.wave === 31) {
            this.set(SplitType.TOB_NYLO_WAVES, event.tick);
          }
          break;

        case EventType.TOB_NYLO_CLEANUP_END:
          this.set(SplitType.TOB_NYLO_CLEANUP, event.tick);
          break;

        case EventType.TOB_NYLO_BOSS_SPAWN:
          this.set(SplitType.TOB_NYLO_BOSS_SPAWN, event.tick);
          break;

        case EventType.TOB_SOTE_MAZE_PROC:
          if (event.soteMaze.maze === Maze.MAZE_66) {
            this.set(SplitType.TOB_SOTETSEG_66, event.tick);
          } else {
            this.set(SplitType.TOB_SOTETSEG_33, event.tick);
          }
          break;

        case EventType.TOB_XARPUS_PHASE:
          if (event.xarpusPhase === XarpusPhase.P2) {
            this.set(SplitType.TOB_XARPUS_EXHUMES, event.tick);
          } else if (event.xarpusPhase === XarpusPhase.P3) {
            this.set(SplitType.TOB_XARPUS_SCREECH, event.tick);
          }
          break;

        case EventType.TOB_VERZIK_PHASE:
          if (event.verzikPhase === VerzikPhase.P2) {
            this.set(SplitType.TOB_VERZIK_P1_END, event.tick);
          } else if (event.verzikPhase === VerzikPhase.P3) {
            this.set(SplitType.TOB_VERZIK_P2_END, event.tick);
          }
          break;
      }
    }

    const changed = this.changed;
    return changed;
  }

  rebuild(events: Event[]): void {
    this.clear();
    this.processEvents(events);
  }

  clear(): void {
    this.map = {};
  }

  private set(type: SplitType, tick: number): void {
    if (tick > 0) {
      this.map[type] = tick;
      this.changed = true;
    }
  }
}
