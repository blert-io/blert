export type ApiKey = {
  id: number;
  key: string;
  lastUsed: Date | null;
  active: boolean;
};

export type User = {
  id: number;
  username: string;
  displayUsername: string | null;
  createdAt: Date;
  email: string;
  emailVerified: boolean;
  canCreateApiKey: boolean;
  discordId: string | null;
  discordUsername: string | null;
};

// The ordering in this enum is significant as it is used for prioritization in
// the database.
export enum RecordingType {
  SPECTATOR = 0,
  PARTICIPANT = 1,
}

export type RecordedChallenge = {
  challengeId: string;
  recorderId: number;
  recordingType: RecordingType;
};
