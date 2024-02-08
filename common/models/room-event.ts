import { Schema, model, models } from 'mongoose';

import { Event, EventType } from '../event';
import { Room } from '../raid-definitions';

const SkillLevel = {
  skill: String,
  base: Number,
  current: Number,
};

const Coords = {
  _id: false,
  x: Number,
  y: Number,
};

const Item = {
  _id: false,
  id: Number,
  quantity: Number,
  name: String,
};

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
    id: Number,
    roomId: Number,
    hitpoints: SkillLevel,
  },
  attack: {
    type: { type: String },
    weapon: Item,
    target: {
      id: Number,
      roomId: Number,
    },
  },
  maidenEntity: {
    bloodSplats: [Coords],
    crab: {
      spawn: String,
      position: String,
      scuffed: Boolean,
    },
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
});

export const RoomEvent =
  models?.RoomEvent ?? model('RoomEvent', roomEventSchema);
