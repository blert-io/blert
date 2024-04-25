import { Types } from 'mongoose';

export enum NameChangeStatus {
  PENDING,
  ACCEPTED,
  OLD_STILL_IN_USE,
  NEW_DOES_NOT_EXIST,
  DECREASED_EXPERIENCE,
}

export type NameChange = {
  status: NameChangeStatus;
  oldName: string;
  newName: string;
  playerId: Types.ObjectId;
  submitterId: Types.ObjectId | null;
  processedAt: Date | null;
  migratedDocuments: number;
};
