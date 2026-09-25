import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProjectRoleDefinitionDocument = HydratedDocument<ProjectRoleDefinition>;

/**
 * Module 6's Project Roles - a reusable, org-wide named role (e.g. "Administrators", "Developers",
 * "QA Lead"), mirroring Jira's own Project Roles model: the *definition* (this document) is
 * org-scoped and shared across every project, while *who* fills that role varies per project (see
 * `Project.roleAssignments` in project.schema.ts). This is what lets a Permission/Security Scheme
 * grant "the Developers role" once and have it resolve to a different set of people on every
 * project that uses it - the actual gap this codebase had (see this module's own research: only a
 * flat global Role enum + ad hoc per-member capability flags existed before this).
 *
 * Deliberately not auto-seeded with defaults (e.g. Jira's built-in 3) - mirrors how
 * PermissionScheme requires an Admin to create the first one; an org with none configured is
 * simply unaffected until an Admin opts in, same "additive, zero-impact-until-configured"
 * convention as every other scheme in this codebase.
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
export class ProjectRoleDefinition {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  name!: string;

  @Prop({ default: '', maxlength: 500 })
  description!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ProjectRoleDefinitionSchema = SchemaFactory.createForClass(ProjectRoleDefinition);

ProjectRoleDefinitionSchema.index({ organizationId: 1 });
ProjectRoleDefinitionSchema.index({ organizationId: 1, name: 1 }, { unique: true });
