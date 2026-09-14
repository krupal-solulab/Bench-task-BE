import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Sprint, SprintDocument } from './schemas/sprint.schema';
import {
  SprintActivity,
  SprintActivityAction,
  SprintActivityDocument,
} from './schemas/sprint-activity.schema';
import { SprintStatus } from '../../common/enums/sprint-status.enum';
import { ListSprintsDto } from './dto/list-sprints.dto';

const POPULATE_FIELDS = 'name email role isActive';

@Injectable()
export class SprintsRepository {
  constructor(
    @InjectModel(Sprint.name) private readonly model: Model<SprintDocument>,
    @InjectModel(SprintActivity.name)
    private readonly activityModel: Model<SprintActivityDocument>,
  ) {}

  create(data: Partial<Sprint>): Promise<SprintDocument> {
    return this.model.create(data);
  }

  findByIdActive(id: string): Promise<SprintDocument | null> {
    return this.model.findOne({ _id: id, deletedAt: null }).exec();
  }

  findByIdActiveInProject(id: string, projectId: string): Promise<SprintDocument | null> {
    return this.model
      .findOne({ _id: id, project: new Types.ObjectId(projectId), deletedAt: null })
      .exec();
  }

  findActiveSprintForProject(projectId: string): Promise<SprintDocument | null> {
    return this.model
      .findOne({
        project: new Types.ObjectId(projectId),
        status: SprintStatus.ACTIVE,
        deletedAt: null,
      })
      .exec();
  }

  async paginate(
    projectId: string,
    query: ListSprintsDto,
  ): Promise<{ data: SprintDocument[]; total: number }> {
    const filter: FilterQuery<SprintDocument> = {
      project: new Types.ObjectId(projectId),
      deletedAt: null,
    };
    if (query.status?.length) filter.status = { $in: query.status };

    const skip = (query.page - 1) * query.limit;
    const [data, total] = await Promise.all([
      this.model.find(filter).sort({ startDate: 1 }).skip(skip).limit(query.limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async updateById(id: string, update: Partial<Sprint>): Promise<SprintDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findByIdActive(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { deletedAt: new Date() }).exec();
  }

  async logActivity(
    sprintId: string,
    actorId: string,
    action: SprintActivityAction,
    from: string | null = null,
    to: string | null = null,
  ): Promise<void> {
    await this.activityModel.create({
      sprint: new Types.ObjectId(sprintId),
      actor: new Types.ObjectId(actorId),
      action,
      from,
      to,
    });
  }

  async paginateActivity(
    sprintId: string,
    page: number,
    limit: number,
  ): Promise<{ data: SprintActivityDocument[]; total: number }> {
    const filter = { sprint: new Types.ObjectId(sprintId) };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.activityModel
        .find(filter)
        .populate('actor', POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.activityModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }
}
