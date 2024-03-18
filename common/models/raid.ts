import { Model, Schema, model, models } from 'mongoose';
import { Raid } from '../raid-definitions';

export const Coords = {
  _id: false,
  x: Number,
  y: Number,
};

export const MaidenCrabProperties = {
  _id: false,
  spawn: String,
  position: String,
  scuffed: Boolean,
};

export const NyloProperties = {
  _id: false,
  parentRoomId: Number,
  wave: Number,
  style: String,
  spawnType: String,
};

export const VerzikCrabProperties = {
  _id: false,
  phase: String,
  spawn: String,
};

const RoomNpc = {
  type: { type: String },
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

const raidSchema = new Schema<Raid>({
  _id: String,
  status: { type: String, index: true },
  mode: String,
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
  partyInfo: { type: [PlayerInfo], default: null },
  totalRoomTicks: { type: Number, default: 0, index: true },
  totalDeaths: { type: Number, default: 0 },
  rooms: {
    MAIDEN: {
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
    BLOAT: {
      type: {
        ...RoomOverview,
        splits: {
          downTicks: [Number],
        },
      },
      default: null,
    },
    NYLOCAS: {
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
    SOTETSEG: {
      type: {
        ...RoomOverview,
        splits: {
          MAZE_66: Number,
          MAZE_33: Number,
        },
      },
      default: null,
    },
    XARPUS: {
      type: {
        ...RoomOverview,
        splits: {
          exhumes: Number,
          screech: Number,
        },
      },
      default: null,
    },
    VERZIK: {
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
});

export const RaidModel =
  (models?.Raid as Model<Raid>) ?? model<Raid>('Raid', raidSchema);
