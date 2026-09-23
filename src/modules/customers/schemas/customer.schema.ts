import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CustomerTier } from '../../../common/enums/customer-tier.enum';

export type CustomerDocument = HydratedDocument<Customer>;

/**
 * An external contact record for the support-ticketing domain - deliberately NOT a `User`
 * (no password, no role, no staff login). In this batch, purely a contact staff can create/select
 * when filing a ticket on a customer's behalf (email, phone call), exactly like a CRM contact.
 * Real customer *login* (magic-link auth) is a later batch's job, once a real mailer exists -
 * see the plan's "Customer-auth design constraints" section for why that's deliberately deferred.
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
export class Customer {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  // Lowercased/trimmed at write time (see CustomersService) - compound-unique with
  // organizationId, not unique on its own, since the same person can be a customer of more than
  // one org.
  @Prop({ required: true, trim: true, lowercase: true, maxlength: 200 })
  email!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 120 })
  name!: string;

  @Prop({ type: String, enum: CustomerTier, default: CustomerTier.STANDARD })
  tier!: CustomerTier;

  createdAt!: Date;
  updatedAt!: Date;
}

export const CustomerSchema = SchemaFactory.createForClass(Customer);

CustomerSchema.index({ organizationId: 1, email: 1 }, { unique: true });
