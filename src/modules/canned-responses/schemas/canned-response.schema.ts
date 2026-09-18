import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CannedResponseDocument = HydratedDocument<CannedResponse>;

/**
 * A reusable text snippet any org member can insert into a task comment (Role-surface polish -
 * the BRD's "Agent" canned-responses gap, mapped onto the existing Developer/Manager/Admin roles
 * per user decision). Deliberately a shared, org-wide resource with no per-item ownership gate -
 * `createdBy` is recorded for display only, never checked for access control (see
 * CannedResponsesService).
 */
@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class CannedResponse {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  title!: string;

  // Same cap as Comment.body (comments.schema.ts) - a canned response is inserted verbatim into
  // a comment, so it can never itself exceed what a comment could already hold.
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 2000 })
  body!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const CannedResponseSchema = SchemaFactory.createForClass(CannedResponse);

CannedResponseSchema.index({ organizationId: 1, createdAt: -1 });
