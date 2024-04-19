import { Types } from 'mongoose';

export type ApiKey = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  playerId: Types.ObjectId;
  key: string;
  lastUsed: Date | null;
  active: boolean;
};

export type User = {
  _id: Types.ObjectId;
  username: string;
  password: string;
  email: string;
  emailVerified: boolean;

  // TODO(frolv): This is temporary for controlling initial access to the API.
  canCreateApiKey: boolean;
};

export enum RecordingType {
  SPECTATOR = 'SPECTATOR',
  RAIDER = 'RAIDER',
}

export type RecordedChallenge = {
  cId: string;
  recorderId: Types.ObjectId;
  recordingType: RecordingType;
};
