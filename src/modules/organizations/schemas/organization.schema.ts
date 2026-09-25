import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { OrganizationStatus } from '../../../common/enums/organization-status.enum';
import {
  LinkTypeDefinition,
  LinkTypeDefinitionSchema,
} from '../../planning/schemas/link-type.schema';

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    // Mongoose's transform typings don't carry the schema's field shape through; `any` is the
    // documented escape hatch for this callback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Organization {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 120 })
  name!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug!: string;

  @Prop({ type: String, enum: OrganizationStatus, default: OrganizationStatus.ACTIVE })
  status!: OrganizationStatus;

  @Prop({ type: Date, default: null })
  suspendedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId | null;

  // Module 1's issue-link type catalog (Blocks/Relates To/Duplicates/...) - org-wide since a link
  // can cross projects. Empty (the default for every existing org) resolves to DEFAULT_LINK_TYPES.
  @Prop({ type: [LinkTypeDefinitionSchema], default: [] })
  linkTypes!: LinkTypeDefinition[];

  // Module 8's org Settings - self-service fields an org's own Admin can manage (see
  // OrganizationSettingsController), distinct from `name`/`status`, which stay Platform-Admin-only.
  // 'UTC' for every existing org until an Admin opts into a different one.
  @Prop({ default: 'UTC', maxlength: 60 })
  timezone!: string;

  @Prop({ type: String, default: null, maxlength: 500 })
  logoUrl!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);

OrganizationSchema.index({ status: 1 });
