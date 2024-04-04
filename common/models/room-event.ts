import { Model, Schema, model, models } from 'mongoose';

import {
  Coords,
  MaidenCrabProperties,
  NyloProperties,
  VerzikCrabProperties,
} from './raid';
import { MergedEvent } from '../event';

const SkillLevel = {
  _id: false,
  base: Number,
  current: Number,
};

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
    hitpoints: SkillLevel,
    prayerSet: Number,
    equipment: {
      HEAD: Item,
      CAPE: Item,
      AMULET: Item,
      AMMO: Item,
      WEAPON: Item,
      TORSO: Item,
      SHIELD: Item,
      LEGS: Item,
      GLOVES: Item,
      BOOTS: Item,
      RING: Item,
    },
    offCooldownTick: Number,
  },
  npc: {
    type: { type: Number },
    id: Number,
    roomId: Number,
    hitpoints: SkillLevel,
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
  bloatStatus: {
    walkTime: Number,
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
