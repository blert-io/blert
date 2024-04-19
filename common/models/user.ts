import { Model, Schema, model, models } from 'mongoose';
import { RecordedChallenge, User } from '../user';

const userSchema = new Schema<User>({
  username: { type: String, required: true, index: true },
  password: { type: String, required: true },
  email: { type: String, required: true, index: { unique: true } },
  emailVerified: { type: Boolean, required: true, default: false },
  canCreateApiKey: { type: Boolean, default: false },
});

export const UserModel =
  (models?.User as Model<User>) ?? model<User>('User', userSchema);

const recordedChallengeSchema = new Schema<RecordedChallenge>({
  cId: { type: String, required: true, index: true },
  recorderId: { type: Schema.Types.ObjectId, required: true, index: true },
  recordingType: { type: String, required: true },
});

export const RecordedChallengeModel =
  (models?.RecordedChallenge as Model<RecordedChallenge>) ??
  model<RecordedChallenge>('RecordedChallenge', recordedChallengeSchema);
