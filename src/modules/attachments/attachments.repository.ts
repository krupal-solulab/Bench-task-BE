import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Attachment, AttachmentDocument } from './schemas/attachment.schema';

const UPLOADER_POPULATE = 'name email role isActive';

@Injectable()
export class AttachmentsRepository {
  constructor(@InjectModel(Attachment.name) private readonly model: Model<AttachmentDocument>) {}

  create(data: Partial<Attachment>): Promise<AttachmentDocument> {
    return this.model.create(data);
  }

  findByIdActive(id: string): Promise<AttachmentDocument | null> {
    return this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('uploadedBy', UPLOADER_POPULATE)
      .exec();
  }

  async paginateForTask(
    taskId: string,
    page: number,
    limit: number,
  ): Promise<{ data: AttachmentDocument[]; total: number }> {
    const filter = { task: new Types.ObjectId(taskId), deletedAt: null };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('uploadedBy', UPLOADER_POPULATE)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  async softDelete(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { deletedAt: new Date() }).exec();
  }
}
