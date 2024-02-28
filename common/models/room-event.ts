import { Schema, model, models } from 'mongoose';
import {
  Coords,
  MaidenCrabProperties,
  NyloProperties,
  VerzikCrabProperties,
} from './raid';

const SkillLevel = {
  skill: String,
  base: Number,
  current: Number,
};

const Item = {
  _id: false,
  id: Number,
  quantity: Number,
  name: String,
};

const attackSchema = new Schema(
  {
    type: String,
    weapon: Item,
    target: {
      id: Number,
      roomId: Number,
    },
    distanceToTarget: Number,
  },
  { _id: false },
);

const roomEventSchema = new Schema({
  raidId: { type: String, index: true },
  type: String,
  room: String,
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
    type: { type: String },
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
    attack: String,
    target: String,
  },
  maidenBloodSplats: {
    type: [Coords],
    default: undefined,
  },
  bloatStatus: {
    walkTime: Number,
  },
  nyloWave: {
    wave: Number,
    nylosAlive: Number,
    roomCap: Number,
  },
  soteMaze: {
    maze: String,
  },
  xarpusPhase: String,
  verzikPhase: String,
  verzikAttack: {
    style: String,
    npcAttackTick: Number,
  },
});

export const RoomEvent =
  models?.RoomEvent ?? model('RoomEvent', roomEventSchema);
