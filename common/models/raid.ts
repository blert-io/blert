import { Schema, model } from 'mongoose';

const raidSchema = new Schema({
  _id: String,
  status: String,
  mode: String,
  startTime: { type: Date },
  party: { type: [String], index: true },
  totalRoomTicks: { type: Number, default: 0 },
});

export const Raid = model('Raid', raidSchema);
