import { ApiKey } from '../user';
import { Model, Schema, model, models } from 'mongoose';

const apiKeySchema = new Schema<ApiKey>({
  // The default _id field doubles as the API key (as a string).
  userId: { type: Schema.Types.ObjectId, required: true, index: true },
});

export const ApiKeyModel =
  (models?.ApiKey as Model<ApiKey>) ?? model<ApiKey>('ApiKey', apiKeySchema);
