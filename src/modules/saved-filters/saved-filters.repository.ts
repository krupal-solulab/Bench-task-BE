import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  SavedFilter,
  SavedFilterDocument,
  SavedFilterScope,
  SavedFilterVisibility,
} from './schemas/saved-filter.schema';

@Injectable()
export class SavedFiltersRepository {
  constructor(@InjectModel(SavedFilter.name) private readonly model: Model<SavedFilterDocument>) {}

  create(data: Partial<SavedFilter>): Promise<SavedFilterDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<SavedFilterDocument | null> {
    return this.model.findById(id).exec();
  }

  /**
   * The caller's own filters matching `filters`, plus - only when `scope: PROJECT` and a
   * `projectId` are both given - any other owner's `SHARED` filter for that same project. For
   * every other combination (scope omitted, or `scope: MY_TASKS`) this is byte-identical to the
   * owner-only query that existed before sharing (Search/Dashboards v2).
   */
  find(
    ownerId: string,
    filters: { scope?: SavedFilterScope; projectId?: string },
  ): Promise<SavedFilterDocument[]> {
    const ownerFilter: FilterQuery<SavedFilterDocument> = { owner: new Types.ObjectId(ownerId) };
    if (filters.scope) ownerFilter.scope = filters.scope;
    if (filters.projectId) ownerFilter.projectId = new Types.ObjectId(filters.projectId);

    if (filters.scope !== SavedFilterScope.PROJECT || !filters.projectId) {
      return this.model.find(ownerFilter).sort({ createdAt: -1 }).exec();
    }

    const sharedFilter: FilterQuery<SavedFilterDocument> = {
      scope: SavedFilterScope.PROJECT,
      projectId: new Types.ObjectId(filters.projectId),
      visibility: SavedFilterVisibility.SHARED,
    };
    return this.model
      .find({ $or: [ownerFilter, sharedFilter] })
      .sort({ createdAt: -1 })
      .exec();
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
