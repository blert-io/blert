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
  skill: String, // TODO: delete
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
    typeString: String,
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
  raidId: { type: String, index: true },
  cId: { type: String, index: true },
  type: { type: Number, index: true },
  typeString: String,
  stage: { type: Number, index: true },
  room: String,
  roomString: String,
  tick: Number,
  xCoord: Number,
  yCoord: Number,
  player: {
    name: String,
    hitpoints: SkillLevel,
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
    typeString: String,
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
    attackString: String,
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
    mazeString: String,
  },
  xarpusPhase: Number,
  xarpusPhaseString: String,
  verzikPhase: Number,
  verzikPhaseString: String,
  verzikAttack: {
    style: Number,
    styleString: String,
    npcAttackTick: Number,
  },
});

export const RoomEvent: Model<MergedEvent> =
  models?.RoomEvent ?? model('RoomEvent', roomEventSchema);
