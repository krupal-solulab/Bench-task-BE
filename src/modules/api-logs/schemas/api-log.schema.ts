import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ApiLogDocument = HydratedDocument<ApiLog>;

const RETENTION_SECONDS = 30 * 24 * 60 * 60; // 30 days

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: {
    virtuals: true,
    // Mongoose's transform typings don't carry the schema's field shape through; `any` is the
    // documented escape hatch for this callback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      // organizationId is populated with { name, slug, ... } by the repository for display -
      // renamed here so the API shape matches every other populated-ref response in this app.
      ret.organization = ret.organizationId ?? null;
      delete ret._id;
      delete ret.__v;
      delete ret.organizationId;
      return ret;
    },
  },
})
export class ApiLog {
  @Prop({ required: true })
  method!: string;

  @Prop({ required: true })
  path!: string;

  @Prop({ required: true })
  statusCode!: number;

  // Not a hard ref requirement (organizationId is null for public/unauthenticated requests and
  // for PlatformAdmin-issued requests, which have no organization of their own).
  @Prop({ type: Types.ObjectId, ref: 'Organization', default: null })
  organizationId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  userId!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  userEmail!: string | null;

  @Prop({ required: true })
  durationMs!: number;

  @Prop({ type: String, default: null })
  ip!: string | null;

  @Prop({ type: String, default: null })
  userAgent!: string | null;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  createdAt!: Date;
}

export const ApiLogSchema = SchemaFactory.createForClass(ApiLog);

ApiLogSchema.index({ createdAt: -1 });
ApiLogSchema.index({ organizationId: 1, createdAt: -1 });
ApiLogSchema.index({ statusCode: 1, createdAt: -1 });
ApiLogSchema.index({ method: 1, createdAt: -1 });
// TTL index: MongoDB automatically deletes documents once createdAt is older than this many
// seconds, so this collection can never grow without bound in production.
ApiLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });
