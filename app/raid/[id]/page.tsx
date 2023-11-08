'use client';

import { useEffect, useState } from 'react';

import Map, { PlayerEntity } from '../../components/map';
import { EventType, RaidStats, RaidStatus } from '../stats';

const fakeRaidData: RaidStats = {
  id: 'nessie',
  players: ['Sacolyn'],
  status: RaidStatus.BLOAT_WIPE,
  rooms: {
    maiden: {
      events: [
        {
          type: EventType.PLAYER,
          tick: 1,
          xCoord: 3184,
          yCoord: 4448,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 1,
          xCoord: 3184,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 2,
          xCoord: 3182,
          yCoord: 4448,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 2,
          xCoord: 3182,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 3,
          xCoord: 3180,
          yCoord: 4448,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 3,
          xCoord: 3180,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 4,
          xCoord: 3178,
          yCoord: 4448,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 4,
          xCoord: 3178,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 5,
          xCoord: 3177,
          yCoord: 4447,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 5,
          xCoord: 3176,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 6,
          xCoord: 3177,
          yCoord: 4447,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 6,
          xCoord: 3174,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 7,
          xCoord: 3175,
          yCoord: 4447,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 7,
          xCoord: 3172,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 8,
          xCoord: 3173,
          yCoord: 4447,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 8,
          xCoord: 3170,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 9,
          xCoord: 3171,
          yCoord: 4447,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 9,
          xCoord: 3168,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 10,
          xCoord: 3169,
          yCoord: 4447,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 10,
          xCoord: 3167,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 11,
          xCoord: 3167,
          yCoord: 4447,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 11,
          xCoord: 3166,
          yCoord: 4449,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 12,
          xCoord: 3167,
          yCoord: 4447,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 12,
          xCoord: 3165,
          yCoord: 4449,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 13,
          xCoord: 3168,
          yCoord: 4445,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 13,
          xCoord: 3165,
          yCoord: 4449,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 14,
          xCoord: 3168,
          yCoord: 4445,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 14,
          xCoord: 3165,
          yCoord: 4449,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 15,
          xCoord: 3168,
          yCoord: 4445,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 15,
          xCoord: 3167,
          yCoord: 4449,
          player: {
            name: 'NAN0SAUR',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 16,
          xCoord: 3167,
          yCoord: 4445,
          player: {
            name: 'Sacolyn',
          },
        },
        {
          type: EventType.PLAYER,
          tick: 16,
          xCoord: 3167,
          yCoord: 4448,
          player: {
            name: 'NAN0SAUR',
          },
        },
      ],
    },
  },
};

const MAIDEN_X = 3159;
const MAIDEN_Y = 4434;
const MAIDEN_WIDTH = 28;
const MAIDEN_HEIGHT = 24;
const maidenBaseTiles = require('./maiden.json');

type RaidParams = {
  id: string;
};

function ticksToFormattedSeconds(ticks: number): string {
  // Track time in milliseconds to avoid floating point math.
  const milliseconds = ticks * 600;

  const seconds = Math.floor(milliseconds / 1000);
  const deciseconds = (milliseconds % 1000) / 100;

  return `${seconds}.${deciseconds}s`;
}

export default function Raid({ params }: { params: RaidParams }) {
  const [tick, setTick] = useState(1);
  const [playing, setPlaying] = useState(false);

  const maidenEvents = fakeRaidData.rooms.maiden!.events;
  const eventsForTick = maidenEvents.filter((evt) => evt.tick === tick);

  useEffect(() => {
    if (playing) {
      const lastTick = maidenEvents[maidenEvents.length - 1].tick;
      if (tick < lastTick) {
        window.setTimeout(() => setTick(tick + 1), 600);
      } else {
        setPlaying(false);
      }
    }
  }, [tick, playing]);

  const players = eventsForTick
    .filter((evt) => evt.type === EventType.PLAYER)
    .map((evt) => new PlayerEntity(evt.xCoord, evt.yCoord, evt.player.name));

  return (
    <div style={{ margin: '1em' }}>
      <p>raid {params.id}</p>
      <button
        disabled={playing}
        style={{ border: '1px solid grey', margin: '1em 0' }}
        onClick={() => {
          setTick(1);
          setPlaying(true);
        }}
      >
        Play
      </button>
      <p>
        tick: {tick} ({ticksToFormattedSeconds(tick)})
      </p>
      <Map
        x={MAIDEN_X}
        y={MAIDEN_Y}
        width={MAIDEN_WIDTH}
        height={MAIDEN_HEIGHT}
        baseTiles={maidenBaseTiles}
        tileSize={40}
        entities={players}
      />
    </div>
  );
}
