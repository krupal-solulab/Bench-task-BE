import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TicketCommentDocument = HydratedDocument<TicketComment>;

export enum TicketCommentAuthorType {
  STAFF = 'staff',
  CUSTOMER = 'customer',
}

/**
 * Either a customer-visible reply or an internal note - `isPublic` is load-bearing, not cosmetic:
 * Batch 1's Triggers fire on "customer commented" (a public, customer-authored comment), and a
 * ticket's SLA first-response time is measured off the first `isPublic` STAFF reply. Author is one
 * of two distinct identities (staff `User` or `Customer`), never both.
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
      return ret;
    },
  },
})
export class TicketComment {
  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true })
  ticket!: Types.ObjectId;

  @Prop({ type: String, enum: TicketCommentAuthorType, required: true })
  authorType!: TicketCommentAuthorType;

  // Exactly one of these two is set, matching `authorType` - enforced in TicketsService, not at
  // the schema level (Mongoose has no clean discriminated-union validator for two plain refs).
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  authorUser!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Customer', default: null })
  authorCustomer!: Types.ObjectId | null;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 10000 })
  body!: string;

  // true = a reply the customer sees; false = an internal note visible only to staff.
  @Prop({ type: Boolean, default: true })
  isPublic!: boolean;

  createdAt!: Date;
}

export const TicketCommentSchema = SchemaFactory.createForClass(TicketComment);

TicketCommentSchema.index({ ticket: 1, createdAt: 1 });
