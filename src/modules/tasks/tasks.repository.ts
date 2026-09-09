import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { TaskStatus } from '../../common/enums/task-status.enum';
import { Task, TaskDocument } from './schemas/task.schema';
import {
  TaskActivity,
  TaskActivityAction,
  TaskActivityDocument,
} from './schemas/task-activity.schema';
import { ListTasksDto } from './dto/list-tasks.dto';
import { buildTaskListFilter } from './utils/task-filter.util';

const POPULATE_FIELDS = 'name email role isActive';

@Injectable()
export class TasksRepository {
  constructor(
    @InjectModel(Task.name) private readonly model: Model<TaskDocument>,
    @InjectModel(TaskActivity.name) private readonly activityModel: Model<TaskActivityDocument>,
  ) {}

  create(data: Partial<Task>): Promise<TaskDocument> {
    return this.model.create(data);
  }

  findByIdActive(id: string): Promise<TaskDocument | null> {
    return this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('assignee', POPULATE_FIELDS)
      .populate('createdBy', POPULATE_FIELDS)
      .populate('project', 'name')
      .exec();
  }

  findRawById(id: string): Promise<TaskDocument | null> {
    return this.model.findOne({ _id: id, deletedAt: null }).exec();
  }

  async paginate(
    query: ListTasksDto,
    scope: FilterQuery<TaskDocument> = {},
  ): Promise<{ data: TaskDocument[]; total: number }> {
    const filter = buildTaskListFilter(query, scope);
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('assignee', POPULATE_FIELDS)
        .populate('createdBy', POPULATE_FIELDS)
        .populate('project', 'name')
        .sort({ [query.sortBy]: sortOrder })
        .skip(skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async updateById(id: string, update: Partial<Task>): Promise<TaskDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findByIdActive(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { deletedAt: new Date() }).exec();
  }

  /** Assigned, not-yet-Done, not-yet-notified tasks whose due date falls within the given window. */
  findDueSoonUnnotified(now: Date, threshold: Date): Promise<TaskDocument[]> {
    return this.model
      .find({
        deletedAt: null,
        dueDateNotifiedAt: null,
        assignee: { $ne: null },
        status: { $ne: TaskStatus.DONE },
        dueDate: { $gte: now, $lte: threshold },
      })
      .exec();
  }

  async markDueDateNotified(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { dueDateNotifiedAt: new Date() }).exec();
  }

  async logActivity(
    taskId: string,
    actorId: string,
    action: TaskActivityAction,
    from: string | null = null,
    to: string | null = null,
  ): Promise<void> {
    await this.activityModel.create({
      task: new Types.ObjectId(taskId),
      actor: new Types.ObjectId(actorId),
      action,
      from,
      to,
    });
  }

  async paginateActivity(
    taskId: string,
    page: number,
    limit: number,
  ): Promise<{ data: TaskActivityDocument[]; total: number }> {
    const filter = { task: new Types.ObjectId(taskId) };
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
