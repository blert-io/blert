export enum NameChangeStatus {
  PENDING,
  ACCEPTED,
  OLD_STILL_IN_USE,
  NEW_DOES_NOT_EXIST,
  DECREASED_EXPERIENCE,
  DEFERRED,
  FAILED,
}

export enum NameChangeKind {
  STANDARD = 0,
  HISTORIC = 1,
}

export type NameChange = {
  id: number;
  status: NameChangeStatus;
  oldName: string;
  newName: string;
  submittedAt: Date;
  processedAt: Date | null;
  kind: NameChangeKind;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  sequenceId: string | null;
};
