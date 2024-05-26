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
  submittedAt: Date;
  processedAt: Date | null;
};
