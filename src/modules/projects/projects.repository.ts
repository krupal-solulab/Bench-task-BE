import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { extractId } from '../../common/utils/mongo.util';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { Project, ProjectDocument } from './schemas/project.schema';
import { MemberPermissions } from './schemas/member-permissions.schema';
import {
  ProjectActivity,
  ProjectActivityAction,
  ProjectActivityDocument,
} from './schemas/project-activity.schema';
import { ListProjectsDto } from './dto/list-projects.dto';

const OWNER_POPULATE = 'name email role isActive';

@Injectable()
export class ProjectsRepository {
  constructor(
    @InjectModel(Project.name) private readonly model: Model<ProjectDocument>,
    @InjectModel(ProjectActivity.name)
    private readonly activityModel: Model<ProjectActivityDocument>,
  ) {}

  create(data: Partial<Project>): Promise<ProjectDocument> {
    return this.model.create(data);
  }

  findByIdActive(id: string): Promise<ProjectDocument | null> {
    return this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('owner', OWNER_POPULATE)
      .populate('members.user', OWNER_POPULATE)
      .exec();
  }

  findRawById(id: string): Promise<ProjectDocument | null> {
    return this.model.findOne({ _id: id, deletedAt: null }).exec();
  }

  /** Every not-yet-completed, not-deleted project across the whole system (no org filter - used by
   * a system-wide cron sweep, not a request scoped to one org). Module 5 gap-closure: the daily
   * scheduled-backups trigger's project source - a Completed project's configuration/issues are no
   * longer changing day to day, so it's excluded from the ongoing daily sweep (a manual "Download
   * backup" click still works on any project regardless of status). */
  findAllActive(): Promise<ProjectDocument[]> {
    // Archived projects are read-only, so scheduled backups skip them too (Module 8).
    return this.model
      .find({ status: { $ne: ProjectStatus.COMPLETED }, deletedAt: null, archivedAt: null })
      .exec();
  }

  /** Every active project in this org with a Security Scheme assigned - typically a small subset,
   * used by TasksService to build a security-level exclusion filter for list/search endpoints
   * that span multiple projects at once. */
  findWithSecurityScheme(organizationId: string): Promise<ProjectDocument[]> {
    return this.model
      .find({
        organizationId: new Types.ObjectId(organizationId),
        securitySchemeId: { $ne: null },
        deletedAt: null,
      })
      .exec();
  }

  async paginate(
    query: ListProjectsDto,
    scope: FilterQuery<ProjectDocument>,
  ): Promise<{ data: ProjectDocument[]; total: number }> {
    const filter: FilterQuery<ProjectDocument> = { deletedAt: null, ...scope };
    if (query.search) filter.name = { $regex: query.search, $options: 'i' };
    if (query.status) filter.status = query.status;
    if (query.owner) filter.owner = new Types.ObjectId(query.owner);
    if (query.member) filter['members.user'] = new Types.ObjectId(query.member);
    if (query.category) filter.categoryId = new Types.ObjectId(query.category);
    if (query.isTemplate !== undefined) filter.isTemplate = query.isTemplate === 'true';
    // Module 8 gap-closure: archived projects are hidden by default (`archivedAt: null` also
    // matches every pre-existing document, which has no such field at all).
    if (query.archived === 'true') filter.archivedAt = { $ne: null };
    else if (query.archived !== 'all') filter.archivedAt = null;

    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('owner', OWNER_POPULATE)
        .populate('members.user', OWNER_POPULATE)
        .sort({ [query.sortBy]: sortOrder })
        .skip(skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async updateById(id: string, update: Partial<Project>): Promise<ProjectDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findByIdActive(id);
  }

  /** Atomically increments and returns the project's issue-number sequence - a single
   * findOneAndUpdate avoids the read-then-write race a separate read+update would have. */
  async incrementIssueSeq(projectId: string): Promise<number> {
    const updated = await this.model
      .findOneAndUpdate({ _id: projectId }, { $inc: { issueSeq: 1 } }, { new: true })
      .exec();
    return updated!.issueSeq;
  }

  /** True if another project in the org already has this key (used by getOrAssignKey's dedupe loop). */
  async keyExistsInOrg(
    organizationId: string,
    key: string,
    excludeProjectId?: string,
  ): Promise<boolean> {
    const filter: FilterQuery<ProjectDocument> = {
      organizationId: new Types.ObjectId(organizationId),
      key,
    };
    if (excludeProjectId) filter._id = { $ne: excludeProjectId };
    return (await this.model.countDocuments(filter).exec()) > 0;
  }

  async softDelete(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { deletedAt: new Date() }).exec();
  }

  /** Returns the ids that were actually newly added (excludes already-members, since this is
   * idempotent) - used by ProjectsService to log a MEMBER_ADDED activity per genuinely-new member. */
  async addMembers(id: string, userIds: string[]): Promise<string[]> {
    const objectIds = userIds.map((u) => new Types.ObjectId(u));
    const project = await this.model.findById(id).exec();
    if (!project) return [];
    const existing = new Set(project.members.map((m) => m.user.toString()));
    const newObjectIds = objectIds.filter((oid) => !existing.has(oid.toString()));
    if (newObjectIds.length === 0) return [];
    const toAdd = newObjectIds.map((user) => ({ user, joinedAt: new Date() }));
    await this.model.updateOne({ _id: id }, { $push: { members: { $each: toAdd } } }).exec();
    return newObjectIds.map((oid) => oid.toString());
  }

  async removeMember(id: string, userId: string): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { $pull: { members: { user: new Types.ObjectId(userId) } } })
      .exec();
  }

  async setMemberPermissions(
    id: string,
    userId: string,
    permissions: MemberPermissions,
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: id, 'members.user': new Types.ObjectId(userId) },
        { $set: { 'members.$.permissions': permissions } },
      )
      .exec();
  }

  isMember(project: ProjectDocument, userId: string): boolean {
    if (extractId(project.owner) === userId) return true;
    return project.members.some((m) => extractId(m.user) === userId);
  }

  async logActivity(
    projectId: string,
    actorId: string,
    action: ProjectActivityAction,
    from: string | null = null,
    to: string | null = null,
  ): Promise<void> {
    await this.activityModel.create({
      project: new Types.ObjectId(projectId),
      actor: new Types.ObjectId(actorId),
      action,
      from,
      to,
    });
  }

  async paginateActivity(
    projectId: string,
    page: number,
    limit: number,
  ): Promise<{ data: ProjectActivityDocument[]; total: number }> {
    const filter = { project: new Types.ObjectId(projectId) };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.activityModel
        .find(filter)
        .populate('actor', OWNER_POPULATE)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.activityModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }
}
