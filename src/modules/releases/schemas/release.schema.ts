import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ReleaseStatus } from '../../../common/enums/release-status.enum';

export type ReleaseDocument = HydratedDocument<Release>;

/**
 * Module 2's "Fix Version"/"Affects Version" (BRD: Jira's release/version concept) - project-
 * scoped, referenced by Task.fixVersions/affectsVersions. Mirrors Sprint's own shape (a
 * project-scoped, lifecycle-tracked entity with a soft-delete flag), not a per-project embedded
 * array like Project.components - a release needs its own lifecycle (Unreleased/Released/
 * Archived) and target date, which an embedded string list can't carry.
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
export class Release {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  name!: string;

  @Prop({ default: '', maxlength: 2000 })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project!: Types.ObjectId;

  // The planned/target ship date - purely informational until `release()` is called.
  @Prop({ type: Date, default: null })
  releaseDate!: Date | null;

  @Prop({ type: String, enum: ReleaseStatus, default: ReleaseStatus.UNRELEASED })
  status!: ReleaseStatus;

  // The actual release timestamp, set only by the release() action - kept separate from
  // releaseDate (the editable target) the same way Sprint.startedAt is kept separate from
  // startDate. Preserved even if the release is later archived, so "when did this actually ship"
  // stays answerable.
  @Prop({ type: Date, default: null })
  releasedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ReleaseSchema = SchemaFactory.createForClass(Release);

ReleaseSchema.index({ project: 1, status: 1 });
ReleaseSchema.index({ organizationId: 1 });

// A release name only needs to be unique among a project's non-deleted releases - mirrors the
// same "unique-while-active" shape as Organization.slug, without a hard DB-level constraint that
// would block reusing a name after its original release was deleted.
ReleaseSchema.index(
  { project: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
