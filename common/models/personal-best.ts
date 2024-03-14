import { model, models, Model, Schema } from 'mongoose';

import { PersonalBest } from '../personal-best';

const personalBestSchema = new Schema<PersonalBest>({
  type: Number,
  username: { type: String, index: true },
  scale: Number,
  time: Number,
  raidId: String,
});

personalBestSchema.index({ type: 1, scale: 1, time: 1 });

export const PersonalBestModel: Model<PersonalBest> =
  models?.PersonalBest ?? model('PersonalBest', personalBestSchema);
