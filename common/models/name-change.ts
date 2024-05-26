import { Model, Schema, Types, model, models } from 'mongoose';

import { NameChange } from '../name-change';

export type NameChangeSchema = NameChange & {
  _id: Types.ObjectId;
  playerId: Types.ObjectId;
  submitterId: Types.ObjectId | null;
  migratedDocuments: number;
};

const nameChangeSchema = new Schema<NameChangeSchema>({
  status: { type: Number, index: true, required: true },
  oldName: { type: String, required: true },
  newName: { type: String, required: true },
  playerId: {
    type: Schema.Types.ObjectId,
    ref: 'Player',
    index: true,
  },
  submitterId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  processedAt: { type: Date, default: null },
  migratedDocuments: { type: Number, default: 0 },
});

export const NameChangeModel: Model<NameChangeSchema> =
  models?.NameChange ?? model('NameChange', nameChangeSchema);
