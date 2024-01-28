import { Schema, model, models } from 'mongoose';

const RoomOverview = {
  _id: false,
  roomTicks: Number,
};

const raidSchema = new Schema({
  _id: String,
  status: String,
  mode: String,
  startTime: { type: Date },
  party: { type: [String], index: true },
  totalRoomTicks: { type: Number, default: 0 },
  rooms: {
    MAIDEN: RoomOverview,
    BLOAT: RoomOverview,
    NYLOCAS: RoomOverview,
    SOTETSEG: RoomOverview,
    XARPUS: RoomOverview,
    VERZIK: RoomOverview,
  },
});

export const RaidModel = models?.Raid ?? model('Raid', raidSchema);
