import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TeamDocument = HydratedDocument<Team>;

/**
 * Module 6's Teams - a named, org-wide group of users with no concept in this codebase until now
 * (confirmed by grep: no Team/Group-of-users entity existed anywhere). Deliberately simple (name +
 * members + an optional lead) since Teams here exist to be a *grantee* - referenced from Permission
 * Scheme grants, Security Scheme levels, and per-project Role Assignments - not a project-management
 * feature in its own right.
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
export class Team {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  name!: string;

  @Prop({ default: '', maxlength: 500 })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  leadId!: Types.ObjectId | null;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  memberIds!: Types.ObjectId[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const TeamSchema = SchemaFactory.createForClass(Team);

TeamSchema.index({ organizationId: 1 });
TeamSchema.index({ organizationId: 1, name: 1 }, { unique: true });
