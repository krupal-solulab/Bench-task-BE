import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Comment, CommentDocument } from './schemas/comment.schema';

const AUTHOR_POPULATE = 'name email role isActive';

@Injectable()
export class CommentsRepository {
  constructor(@InjectModel(Comment.name) private readonly model: Model<CommentDocument>) {}

  create(data: Partial<Comment>): Promise<CommentDocument> {
    return this.model.create(data);
  }

  findByIdActive(id: string): Promise<CommentDocument | null> {
    return this.model
      .findOne({ _id: id, deletedAt: null })
      .populate('author', AUTHOR_POPULATE)
      .exec();
  }

  async paginateForTask(
    taskId: string,
    page: number,
    limit: number,
    sortOrder: 'asc' | 'desc',
  ): Promise<{ data: CommentDocument[]; total: number }> {
    const filter = { task: new Types.ObjectId(taskId), deletedAt: null };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('author', AUTHOR_POPULATE)
        .sort({ createdAt: sortOrder === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  async updateById(id: string, body: string): Promise<CommentDocument | null> {
    await this.model.updateOne({ _id: id }, { body }).exec();
    return this.findByIdActive(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { deletedAt: new Date() }).exec();
  }
}
