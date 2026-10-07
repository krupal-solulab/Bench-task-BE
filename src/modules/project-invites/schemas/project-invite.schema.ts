import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PROJECT_MEMBER_ROLES, ProjectMemberRole } from '../../../common/enums/role.enum';

export type ProjectInviteDocument = HydratedDocument<ProjectInvite>;

/** Stored states. "Expired" is never stored - it is a Pending invite past `expiresAt`. */
export enum ProjectInviteStatus {
  PENDING = 'Pending',
  ACCEPTED = 'Accepted',
  REVOKED = 'Revoked',
}

/**
 * An invitation for someone without an account to join a project. Only hashes are stored: a
 * SHA-256 of the link token, and a bcrypt hash of the generated temporary password (which becomes
 * the new account's password hash on acceptance). Both secrets are shown in clear exactly once -
 * to the inviter when sending/resending, and in the invitation email.
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
      delete ret.tokenHash;
      delete ret.tempPasswordHash;
      return ret;
    },
  },
})
export class ProjectInvite {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project!: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  // Legacy: invites sent before the invitee entered their own name carried one. New invites
  // leave it null - the name is asked for when the account is completed.
  @Prop({ type: String, default: null, trim: true, maxlength: 60 })
  name!: string | null;

  @Prop({ type: String, enum: PROJECT_MEMBER_ROLES, required: true })
  role!: ProjectMemberRole;

  @Prop({ required: true, unique: true, select: false })
  tokenHash!: string;

  @Prop({ required: true, select: false })
  tempPasswordHash!: string;

  @Prop({ type: String, enum: ProjectInviteStatus, default: ProjectInviteStatus.PENDING })
  status!: ProjectInviteStatus;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  invitedBy!: Types.ObjectId;

  @Prop({ default: 0 })
  resendCount!: number;

  @Prop({ type: Date, default: null })
  lastSentAt!: Date | null;

  @Prop({ type: Date, default: null })
  acceptedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  acceptedUser!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  revokedBy!: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ProjectInviteSchema = SchemaFactory.createForClass(ProjectInvite);

ProjectInviteSchema.index({ project: 1, createdAt: -1 });
ProjectInviteSchema.index({ email: 1, status: 1 });
