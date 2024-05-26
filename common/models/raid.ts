import { Document, Model, Schema, model, models } from 'mongoose';
import {
  ColosseumData,
  ColosseumChallenge,
  Challenge,
  OldTobRaid,
  OldTobRooms,
  ColosseumWave,
} from '../raid-definitions';

export const Coords = {
  _id: false,
  x: Number,
  y: Number,
};

export const MaidenCrabProperties = {
  _id: false,
  spawn: Number,
  position: Number,
  scuffed: Boolean,
};

export const NyloProperties = {
  _id: false,
  parentRoomId: Number,
  wave: Number,
  style: Number,
  spawnType: Number,
};

export const VerzikCrabProperties = {
  _id: false,
  phase: Number,
  spawn: Number,
};

const RoomNpc = {
  type: { type: Number },
  roomId: Number,
  spawnNpcId: Number,
  spawnTick: Number,
  spawnPoint: Coords,
  deathTick: Number,
  deathPoint: Coords,
  maidenCrab: {
    type: MaidenCrabProperties,
    default: undefined,
  },
  nylo: {
    type: NyloProperties,
    default: undefined,
  },
  verzikCrab: {
    type: VerzikCrabProperties,
    default: undefined,
  },
};

const RoomOverview = {
  _id: false,
  firstTick: { type: Number, default: 0 },
  roomTicks: Number,
  deaths: [String],
  npcs: {
    type: Map,
    of: RoomNpc,
  },
};

const PlayerInfo = {
  _id: false,
  gear: Number,
};

type AllRaids = Challenge &
  Omit<OldTobRaid, 'type'> &
  Omit<ColosseumChallenge, 'type'>;

const tobRoomsSchema = new Schema<OldTobRooms>(
  {
    maiden: {
      type: {
        ...RoomOverview,
        splits: {
          SEVENTIES: Number,
          FIFTIES: Number,
          THIRTIES: Number,
        },
      },
      default: null,
    },
    bloat: {
      type: {
        ...RoomOverview,
        splits: {
          downTicks: [Number],
        },
      },
      default: null,
    },
    nylocas: {
      type: {
        ...RoomOverview,
        splits: {
          capIncrease: Number,
          waves: Number,
          cleanup: Number,
          boss: Number,
        },
        stalledWaves: [Number],
      },
      default: null,
    },
    sotetseg: {
      type: {
        ...RoomOverview,
        splits: {
          MAZE_66: Number,
          MAZE_33: Number,
        },
        maze66: {
          pivots: [Number],
          ticks: Number,
        },
        maze33: {
          pivots: [Number],
          ticks: Number,
        },
      },
      default: null,
    },
    xarpus: {
      type: {
        ...RoomOverview,
        splits: {
          exhumes: Number,
          screech: Number,
        },
      },
      default: null,
    },
    verzik: {
      type: {
        ...RoomOverview,
        redCrabSpawns: Number,
        splits: {
          p1: Number,
          reds: Number,
          p2: Number,
        },
      },
      default: null,
    },
  },
  { _id: false },
);

const colosseumWaveSchema = new Schema<ColosseumWave>(
  {
    ticks: Number,
    handicap: Number,
    options: [Number],
    npcs: {
      type: Map,
      of: RoomNpc,
    },
  },
  { _id: false },
);

const colosseumSchema = new Schema<ColosseumData>(
  {
    handicaps: [Number],
    waves: [colosseumWaveSchema],
  },
  { _id: false },
);

const raidSchema = new Schema<AllRaids>({
  _id: String,
  type: { type: Number, index: true },
  status: { type: Number, index: true },
  stage: { type: Number, index: true },
  mode: Number,
  startTime: { type: Date },
  party: {
    type: [String],
    index: {
      unique: false,
      collation: {
        locale: 'en',
        strength: 2,
      },
    },
  },
  partyIds: { type: [Schema.Types.ObjectId], index: true },
  partyInfo: { type: [PlayerInfo], default: null },
  totalTicks: { type: Number, default: 0, index: true },
  totalDeaths: { type: Number, default: 0 },
  tobRooms: tobRoomsSchema,
  colosseum: colosseumSchema,
});

export const RaidModel =
  (models?.Raid as Model<AllRaids>) ?? model<AllRaids>('Raid', raidSchema);

export type RaidDocument = Document<unknown, {}, AllRaids> & AllRaids;
