import { ApiKey } from '../user';
import { Model, Schema, Types, model, models } from 'mongoose';

export type ApiKeySchema = ApiKey & {
  _id: Types.ObjectId;
  playerId: Types.ObjectId;
  userId: Types.ObjectId;
};

const apiKeySchema = new Schema<ApiKeySchema>({
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
  (models?.ApiKey as Model<ApiKeySchema>) ??
  model<ApiKeySchema>('ApiKey', apiKeySchema);
