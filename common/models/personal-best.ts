import { model, models, Model, Schema } from 'mongoose';

import { PersonalBest } from '../personal-best';

const personalBestSchema = new Schema<PersonalBest>({
  type: { type: Number },
  playerId: { type: Schema.Types.ObjectId, ref: 'Player', index: true },
  cId: { type: String, ref: 'Raid' },
  scale: Number,
  time: Number,
});

personalBestSchema.index({ type: 1, scale: 1, time: 1 });

export const PersonalBestModel: Model<PersonalBest> =
  models?.PersonalBest ?? model('PersonalBest', personalBestSchema);
