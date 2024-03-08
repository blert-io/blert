import { Model, Schema, model, models } from 'mongoose';
import { RecordedRaid, User } from '../user';

const userSchema = new Schema<User>({
  username: { type: String, required: true, index: true },
  password: { type: String, required: true },
});

export const UserModel =
  (models?.User as Model<User>) ?? model<User>('User', userSchema);

const recordedRaidSchema = new Schema<RecordedRaid>({
  raidId: { type: String, required: true, index: true },
  recorderId: { type: Schema.Types.ObjectId, required: true, index: true },
  recordingType: { type: String, required: true },
});

export const RecordedRaidModel =
  (models?.RecordedRaid as Model<RecordedRaid>) ??
  model<RecordedRaid>('RecordedRaid', recordedRaidSchema);
