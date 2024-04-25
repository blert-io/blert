import { Model, Schema, model, models } from 'mongoose';

import { NameChange } from '../name-change';

const nameChangeSchema = new Schema<NameChange>({
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

export const NameChangeModel: Model<NameChange> =
  models?.NameChange ?? model('NameChange', nameChangeSchema);
