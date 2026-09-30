import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProjectBackupSnapshotDocument = HydratedDocument<ProjectBackupSnapshot>;

/**
 * Module 5 gap-closure: persists a copy of every backup this app produces (both the daily
 * scheduled sweep and a manual "Download backup" click) so a project's backup history is listed
 * and re-fetched later, not just downloaded once and gone. `backup` reuses the exact same shape
 * `ImportExportService.ProjectBackup` already returns for a live download - stored as `Object`
 * since that shape already carries several deliberately-`unknown[]` fields (customFields,
 * automationRules, etc. - see import-export.service.ts's own comment on why).
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
export class ProjectBackupSnapshot {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project!: Types.ObjectId;

  @Prop({ type: Object, required: true })
  backup!: unknown;

  createdAt!: Date;
}

export const ProjectBackupSnapshotSchema = SchemaFactory.createForClass(ProjectBackupSnapshot);

ProjectBackupSnapshotSchema.index({ project: 1, createdAt: -1 });
