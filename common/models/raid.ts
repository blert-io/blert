import { Model, Schema, model, models } from 'mongoose';
import { Raid } from '../raid-definitions';

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

const raidSchema = new Schema<Raid>({
  _id: String,
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
  partyInfo: { type: [PlayerInfo], default: null },
  totalTicks: { type: Number, default: 0, index: true },
  totalDeaths: { type: Number, default: 0 },
  rooms: {
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
});

export const RaidModel =
  (models?.Raid as Model<Raid>) ?? model<Raid>('Raid', raidSchema);
