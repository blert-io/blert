import { BCFResolver, BlertChartFormat } from '@blert/bcf';
import { NpcId } from '@blert/common';

import { TimelineDisplay } from '../display-utils';

function splitsByTick(
  display: TimelineDisplay,
  totalTicks: number,
): Record<number, string> {
  const splits: Record<number, string> = {};
  for (let tick = 0; tick < totalTicks; tick++) {
    const name = display.getSplitNameAt(tick);
    if (name !== undefined) {
      splits[tick] = name;
    }
  }
  return splits;
}

describe('TimelineDisplay', () => {
  describe('Verzik reds splits', () => {
    it('defines numbered reds splits, prioritizing phases on the same tick', () => {
      const doc: BlertChartFormat = {
        version: '1.0',
        config: { totalTicks: 504, startTick: 1 },
        timeline: {
          actors: [
            { type: 'player', id: 'caywu', name: 'Caywu' },
            { type: 'player', id: 'lc8', name: 'LC8' },
            {
              type: 'npc',
              id: 'npc-34728',
              name: 'Verzik',
              npcId: NpcId.VERZIK_P1_HARD,
              spawnTick: 0,
              deathTick: 498,
            },
            {
              type: 'npc',
              id: 'npc-39464',
              name: 'Red crab',
              npcId: NpcId.VERZIK_MATOMENOS_HARD,
              spawnTick: 226,
              deathTick: 268,
            },
            {
              type: 'npc',
              id: 'npc-39465',
              name: 'Red crab',
              npcId: NpcId.VERZIK_MATOMENOS_HARD,
              spawnTick: 226,
              deathTick: 268,
            },
            {
              type: 'npc',
              id: 'npc-40201',
              name: 'Red crab',
              npcId: NpcId.VERZIK_MATOMENOS_HARD,
              spawnTick: 270,
              deathTick: 290,
            },
            {
              type: 'npc',
              id: 'npc-40202',
              name: 'Red crab',
              npcId: NpcId.VERZIK_MATOMENOS_HARD,
              spawnTick: 270,
              deathTick: 296,
            },
            {
              type: 'npc',
              id: 'npc-41077',
              name: 'Red crab',
              npcId: NpcId.VERZIK_MATOMENOS_HARD,
              spawnTick: 314,
              deathTick: 316,
            },
            {
              type: 'npc',
              id: 'npc-41078',
              name: 'Red crab',
              npcId: NpcId.VERZIK_MATOMENOS_HARD,
              spawnTick: 314,
              deathTick: 316,
            },
          ],
          ticks: [
            {
              tick: 90,
              cells: [
                {
                  actorId: 'npc-34728',
                  actions: [{ type: 'npcPhase', phaseType: 'TOB_VERZIK_P2' }],
                },
              ],
            },
            {
              tick: 314,
              cells: [
                {
                  actorId: 'npc-34728',
                  actions: [{ type: 'npcPhase', phaseType: 'TOB_VERZIK_P3' }],
                },
              ],
            },
          ],
        },
      };

      const display = new TimelineDisplay(new BCFResolver(doc));

      expect(splitsByTick(display, 504)).toEqual({
        90: 'P1 End',
        103: 'P2',
        226: 'Reds',
        236: 'Attackable',
        270: 'Reds 2',
        280: 'Attackable',
        314: 'P2 End',
        320: 'P3',
      });
    });

    it('labels all attackable ticks if the recording ends before P3', () => {
      const doc: BlertChartFormat = {
        version: '1.0',
        config: { totalTicks: 625, startTick: 1 },
        timeline: {
          actors: [
            { type: 'player', id: 'yieldofin', name: 'Yieldofin' },
            { type: 'player', id: 'caps_lock13', name: 'Caps lock13' },
            {
              type: 'npc',
              id: 'npc-38434',
              name: 'Verzik',
              npcId: NpcId.VERZIK_P1_REGULAR,
              spawnTick: 0,
              deathTick: 0,
            },
            {
              type: 'npc',
              id: 'npc-48728',
              name: 'Red crab',
              npcId: NpcId.VERZIK_MATOMENOS_REGULAR,
              spawnTick: 571,
              deathTick: 613,
            },
            {
              type: 'npc',
              id: 'npc-48729',
              name: 'Red crab',
              npcId: NpcId.VERZIK_MATOMENOS_REGULAR,
              spawnTick: 571,
              deathTick: 613,
            },
            {
              type: 'npc',
              id: 'npc-49433',
              name: 'Red crab',
              npcId: NpcId.VERZIK_MATOMENOS_REGULAR,
              spawnTick: 615,
              deathTick: 625,
            },
          ],
          ticks: [
            {
              tick: 275,
              cells: [
                {
                  actorId: 'npc-38434',
                  actions: [{ type: 'npcPhase', phaseType: 'TOB_VERZIK_P2' }],
                },
              ],
            },
          ],
        },
      };

      const display = new TimelineDisplay(new BCFResolver(doc));

      expect(splitsByTick(display, 625)).toEqual({
        275: 'P1 End',
        288: 'P2',
        571: 'Reds',
        581: 'Attackable',
        615: 'Reds 2',
      });
    });
  });
});
