import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { AuditLogEntry, AuditLogEntryDocument } from './schemas/audit-log-entry.schema';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

const ACTOR_POPULATE = 'name email';

export interface CreateAuditLogEntryData {
  organizationId: string;
  actor: string;
  action: AuditLogEntry['action'];
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown>;
}

@Injectable()
export class AuditLogRepository {
  constructor(
    @InjectModel(AuditLogEntry.name) private readonly model: Model<AuditLogEntryDocument>,
  ) {}

  create(data: CreateAuditLogEntryData): Promise<AuditLogEntryDocument> {
    return this.model.create({
      ...data,
      organizationId: new Types.ObjectId(data.organizationId),
      actor: new Types.ObjectId(data.actor),
    });
  }

  async paginate(
    organizationId: string,
    query: ListAuditLogDto,
  ): Promise<{ data: AuditLogEntryDocument[]; total: number }> {
    const filter = this.buildFilter(organizationId, query);
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('actor', ACTOR_POPULATE)
        .sort({ createdAt: sortOrder })
        .skip(skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  private buildFilter(
    organizationId: string,
    query: ListAuditLogDto,
  ): FilterQuery<AuditLogEntryDocument> {
    const filter: FilterQuery<AuditLogEntryDocument> = {
      organizationId: new Types.ObjectId(organizationId),
    };

    if (query.action) filter.action = query.action;
    if (query.actorId) filter.actor = new Types.ObjectId(query.actorId);

    if (query.dateFrom || query.dateTo) {
      filter.createdAt = {};
      if (query.dateFrom) filter.createdAt.$gte = new Date(query.dateFrom);
      if (query.dateTo) filter.createdAt.$lte = new Date(query.dateTo);
    }

    return filter;
  }
}
