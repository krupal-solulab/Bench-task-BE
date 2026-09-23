import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TicketActivityDocument = HydratedDocument<TicketActivity>;

// Exact mirror of TaskActivityAction's shape, adapted to ticket fields.
export enum TicketActivityAction {
  CREATED = 'created',
  STATUS_CHANGED = 'status_changed',
  REASSIGNED = 'reassigned',
  PRIORITY_CHANGED = 'priority_changed',
  COMMENT_ADDED = 'comment_added',
  DELETED = 'deleted',
}

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
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
export class TicketActivity {
  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true })
  ticket!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actor!: Types.ObjectId;

  @Prop({ type: String, enum: TicketActivityAction, required: true })
  action!: TicketActivityAction;

  @Prop({ type: String, default: null })
  from!: string | null;

  @Prop({ type: String, default: null })
  to!: string | null;

  // Set only when this entry was produced by a ticket automation rule's action rather than
  // directly by `actor` - mirrors TaskActivity.viaAutomationRule, filled in once Batch 1's
  // rule engine actually fires actions.
  @Prop({ type: String, default: null })
  viaAutomationRule!: string | null;

  createdAt!: Date;
}

export const TicketActivitySchema = SchemaFactory.createForClass(TicketActivity);

TicketActivitySchema.index({ ticket: 1, createdAt: -1 });
