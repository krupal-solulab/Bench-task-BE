import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BulkOperationLog, BulkOperationLogDocument } from './schemas/bulk-operation-log.schema';

@Injectable()
export class BulkOperationLogsRepository {
  constructor(
    @InjectModel(BulkOperationLog.name)
    private readonly model: Model<BulkOperationLogDocument>,
  ) {}

  create(data: Partial<BulkOperationLog>): Promise<BulkOperationLogDocument> {
    return this.model.create(data);
  }

  findByIdInOrg(id: string, organizationId: string): Promise<BulkOperationLogDocument | null> {
    return this.model
      .findOne({ _id: id, organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  async markUndone(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { undoneAt: new Date() }).exec();
  }
}
