import { model, models, Model, Schema, Types } from 'mongoose';

type PbSchema = {
  type: number;
  scale: number;
  playerId: Types.ObjectId;
  cId: string;
  time: number;
};

const personalBestSchema = new Schema<PbSchema>({
  type: { type: Number },
  playerId: { type: Schema.Types.ObjectId, ref: 'Player', index: true },
  cId: { type: String, ref: 'Raid' },
  scale: Number,
  time: Number,
});

personalBestSchema.index({ type: 1, scale: 1, time: 1 });

export const PersonalBestModel: Model<PbSchema> =
  models?.PersonalBest ?? model('PersonalBest', personalBestSchema);
