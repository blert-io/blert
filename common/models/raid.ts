import { Schema, model, models } from 'mongoose';

const RoomOverview = {
  _id: false,
  roomTicks: Number,
  deaths: [String],
};

const raidSchema = new Schema({
  _id: String,
  status: String,
  mode: String,
  startTime: { type: Date },
  party: { type: [String], index: true },
  totalRoomTicks: { type: Number, default: 0 },
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

export const RaidModel = models?.Raid ?? model('Raid', raidSchema);
