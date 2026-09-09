import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { extractId } from '../../common/utils/mongo.util';
import { Project, ProjectDocument } from './schemas/project.schema';
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

  async paginate(
    query: ListProjectsDto,
    scope: FilterQuery<ProjectDocument>,
  ): Promise<{ data: ProjectDocument[]; total: number }> {
    const filter: FilterQuery<ProjectDocument> = { deletedAt: null, ...scope };
    if (query.search) filter.name = { $regex: query.search, $options: 'i' };
    if (query.status) filter.status = query.status;
    if (query.owner) filter.owner = new Types.ObjectId(query.owner);
    if (query.member) filter['members.user'] = new Types.ObjectId(query.member);

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
