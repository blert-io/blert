import { ApiKey } from '../user';
import { Model, Schema, model, models } from 'mongoose';

const apiKeySchema = new Schema<ApiKey>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  playerId: {
    type: Schema.Types.ObjectId,
    ref: 'Player',
    required: true,
    index: true,
  },
  key: { type: String, required: true, unique: true, index: true },
  active: { type: Boolean, required: true },
  lastUsed: { type: Date, default: null },
});

export const ApiKeyModel =
  (models?.ApiKey as Model<ApiKey>) ?? model<ApiKey>('ApiKey', apiKeySchema);
