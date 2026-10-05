import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ApiTokenDocument = HydratedDocument<ApiToken>;

/**
 * Module 11 gap-closure: a personal API token. Only a SHA-256 hash of the secret is stored - the
 * secret itself is shown to its owner exactly once, at creation. `prefix` (e.g. "pat_3f9a1c2b")
 * is kept in clear so a token can be recognised in the list without revealing it.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: {
    virtuals: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      delete ret.tokenHash;
      return ret;
    },
  },
})
export class ApiToken {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  owner!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  name!: string;

  @Prop({ required: true, unique: true, select: false })
  tokenHash!: string;

  @Prop({ required: true })
  prefix!: string;

  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;

  @Prop({ type: Date, default: null })
  lastUsedAt!: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  createdAt!: Date;
}

export const ApiTokenSchema = SchemaFactory.createForClass(ApiToken);
ApiTokenSchema.index({ owner: 1, revokedAt: 1 });
ApiTokenSchema.index({ organizationId: 1, revokedAt: 1 });
