import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { ApiLog, ApiLogDocument } from './schemas/api-log.schema';
import { ListApiLogsDto } from './dto/list-api-logs.dto';

const ORGANIZATION_POPULATE = 'name slug';

export interface CreateApiLogData {
  method: string;
  path: string;
  statusCode: number;
  organizationId: string | null;
  userId: string | null;
  userEmail: string | null;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  errorMessage: string | null;
}

@Injectable()
export class ApiLogsRepository {
  constructor(@InjectModel(ApiLog.name) private readonly model: Model<ApiLogDocument>) {}

  create(data: CreateApiLogData): Promise<ApiLogDocument> {
    return this.model.create({
      ...data,
      organizationId: data.organizationId ? new Types.ObjectId(data.organizationId) : null,
      userId: data.userId ? new Types.ObjectId(data.userId) : null,
    });
  }

  async paginate(query: ListApiLogsDto): Promise<{ data: ApiLogDocument[]; total: number }> {
    const filter = this.buildFilter(query);
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('organizationId', ORGANIZATION_POPULATE)
        .sort({ createdAt: sortOrder })
        .skip(skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  private buildFilter(query: ListApiLogsDto): FilterQuery<ApiLogDocument> {
    const filter: FilterQuery<ApiLogDocument> = {};

    if (query.organizationId) filter.organizationId = new Types.ObjectId(query.organizationId);
    if (query.method) filter.method = query.method;

    if (query.statusCode) {
      filter.statusCode = query.statusCode;
    } else if (query.statusClass) {
      const base = Number(query.statusClass[0]) * 100;
      filter.statusCode = { $gte: base, $lt: base + 100 };
    }

    if (query.path) filter.path = { $regex: query.path, $options: 'i' };

    if (query.dateFrom || query.dateTo) {
      filter.createdAt = {};
      if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
      if (query.dateTo) filter.createdAt.$lte = new Date(query.dateTo);
    }

    return filter;
  }
}
