import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { WorkLog, WorkLogDocument } from './schemas/work-log.schema';
import { ListWorkLogsDto } from './dto/list-work-logs.dto';

const USER_POPULATE = 'name email role isActive';

export interface WorkLogUserTotal {
  _id: Types.ObjectId;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  entryCount: number;
}

@Injectable()
export class WorkLogsRepository {
  constructor(@InjectModel(WorkLog.name) private readonly model: Model<WorkLogDocument>) {}

  create(data: Partial<WorkLog>): Promise<WorkLogDocument> {
    return this.model.create(data);
  }

  findByIdActive(id: string): Promise<WorkLogDocument | null> {
    return this.model.findOne({ _id: id, deletedAt: null }).populate('user', USER_POPULATE).exec();
  }

  async paginateForTask(
    taskId: string,
    page: number,
    limit: number,
    sortOrder: 'asc' | 'desc',
  ): Promise<{ data: WorkLogDocument[]; total: number }> {
    const filter = { task: new Types.ObjectId(taskId), deletedAt: null };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('user', USER_POPULATE)
        .sort({ workDate: sortOrder === 'asc' ? 1 : -1, createdAt: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  /** Sum of hours currently logged against a task - used for the estimate-vs-actual summary. */
  async totalHoursForTask(taskId: string): Promise<number> {
    const rows = await this.model.aggregate<{ _id: null; total: number }>([
      { $match: { task: new Types.ObjectId(taskId), deletedAt: null } },
      { $group: { _id: null, total: { $sum: '$hours' } } },
    ]);
    return rows[0]?.total ?? 0;
  }

  buildProjectFilter(
    projectId: string,
    query: Pick<ListWorkLogsDto, 'userId' | 'from' | 'to' | 'billable'>,
  ): FilterQuery<WorkLogDocument> {
    const filter: FilterQuery<WorkLogDocument> = {
      project: new Types.ObjectId(projectId),
      deletedAt: null,
    };
    if (query.userId) filter.user = new Types.ObjectId(query.userId);
    if (query.billable !== undefined) filter.billable = query.billable;
    if (query.from || query.to) {
      filter.workDate = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    return filter;
  }

  async paginateForProject(
    filter: FilterQuery<WorkLogDocument>,
    page: number,
    limit: number,
    sortOrder: 'asc' | 'desc',
  ): Promise<{ data: WorkLogDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('user', USER_POPULATE)
        .populate('task', 'title issueKey')
        .sort({ workDate: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  /** Per-user totals for the project-wide timesheet report. */
  async totalsByUser(filter: FilterQuery<WorkLogDocument>): Promise<WorkLogUserTotal[]> {
    return this.model.aggregate<WorkLogUserTotal>([
      { $match: filter },
      {
        $group: {
          _id: '$user',
          totalHours: { $sum: '$hours' },
          billableHours: { $sum: { $cond: ['$billable', '$hours', 0] } },
          nonBillableHours: { $sum: { $cond: ['$billable', 0, '$hours'] } },
          entryCount: { $sum: 1 },
        },
      },
    ]);
  }

  async updateById(id: string, update: Partial<WorkLog>): Promise<WorkLogDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findByIdActive(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { deletedAt: new Date() }).exec();
  }
}
