import { Types } from 'mongoose';

export type ApiKey = {
  id: number;
  key: string;
  lastUsed: Date | null;
  active: boolean;
};

export type User = {
  id: number;
  username: string;
  createdAt: Date;
  email: string;
  emailVerified: boolean;

  // TODO(frolv): This is temporary for controlling initial access to the API.
  canCreateApiKey: boolean;
};

export enum RecordingType {
  SPECTATOR = 0,
  PARTICIPANT = 1,
}

export type RecordedChallenge = {
  cId: string;
  recorderId: Types.ObjectId;
  recordingType: RecordingType;
};
