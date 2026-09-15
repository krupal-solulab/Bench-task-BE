import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { SavedFilter, SavedFilterDocument, SavedFilterScope } from './schemas/saved-filter.schema';

@Injectable()
export class SavedFiltersRepository {
  constructor(@InjectModel(SavedFilter.name) private readonly model: Model<SavedFilterDocument>) {}

  create(data: Partial<SavedFilter>): Promise<SavedFilterDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<SavedFilterDocument | null> {
    return this.model.findById(id).exec();
  }

  find(
    ownerId: string,
    filters: { scope?: SavedFilterScope; projectId?: string },
  ): Promise<SavedFilterDocument[]> {
    const filter: FilterQuery<SavedFilterDocument> = { owner: new Types.ObjectId(ownerId) };
    if (filters.scope) filter.scope = filters.scope;
    if (filters.projectId) filter.projectId = new Types.ObjectId(filters.projectId);
    return this.model.find(filter).sort({ createdAt: -1 }).exec();
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
