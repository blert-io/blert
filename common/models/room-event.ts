import { Model, Schema, model, models } from 'mongoose';

import { Coords } from './raid';
import { MergedEvent } from '../event';

const Item = {
  _id: false,
  id: Number,
  quantity: Number,
};

const attackSchema = new Schema(
  {
    type: { type: Number, index: true },
    weapon: Item,
    target: {
      id: Number,
      roomId: Number,
    },
    distanceToTarget: Number,
  },
  { _id: false },
);

const roomEventSchema = new Schema<MergedEvent>({
  cId: { type: String, index: true },
  type: { type: Number, index: true },
  stage: { type: Number, index: true },
  tick: Number,
  xCoord: Number,
  yCoord: Number,
  player: {
    name: String,
    hitpoints: Number,
    prayer: Number,
    attack: Number,
    strength: Number,
    defence: Number,
    ranged: Number,
    magic: Number,
    prayerSet: Number,
    equipmentDeltas: {
      type: [Number],
      default: undefined,
    },
    offCooldownTick: Number,
  },
  npc: {
    id: Number,
    roomId: Number,
    hitpoints: Number,
  },
  attack: attackSchema,
  npcAttack: {
    attack: { type: Number, index: true },
    target: String,
  },
  maidenBloodSplats: {
    type: [Coords],
    default: undefined,
  },
  bloatDown: {
    downNumber: Number,
    walkTime: Number,
  },
  nyloWave: {
    wave: Number,
    nylosAlive: Number,
    roomCap: Number,
  },
  soteMaze: {
    maze: Number,
    activeTiles: {
      type: [Coords],
      default: undefined,
    },
  },
  xarpusPhase: Number,
  verzikPhase: Number,
  verzikAttack: {
    style: Number,
    npcAttackTick: Number,
  },
  handicap: Number,
});

export const RoomEvent: Model<MergedEvent> =
  models?.RoomEvent ?? model('RoomEvent', roomEventSchema);
