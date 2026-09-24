import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Release, ReleaseDocument } from './schemas/release.schema';
import { ListReleasesDto } from './dto/list-releases.dto';

@Injectable()
export class ReleasesRepository {
  constructor(@InjectModel(Release.name) private readonly model: Model<ReleaseDocument>) {}

  create(data: Partial<Release>): Promise<ReleaseDocument> {
    return this.model.create(data);
  }

  findByIdActive(id: string): Promise<ReleaseDocument | null> {
    return this.model.findOne({ _id: id, deletedAt: null }).exec();
  }

  findByIdActiveInProject(id: string, projectId: string): Promise<ReleaseDocument | null> {
    return this.model
      .findOne({ _id: id, project: new Types.ObjectId(projectId), deletedAt: null })
      .exec();
  }

  async nameExistsInProject(projectId: string, name: string, excludeId?: string): Promise<boolean> {
    const filter: FilterQuery<ReleaseDocument> = {
      project: new Types.ObjectId(projectId),
      name,
      deletedAt: null,
    };
    if (excludeId) filter._id = { $ne: new Types.ObjectId(excludeId) };
    return (await this.model.exists(filter)) !== null;
  }

  /** Every given id that exists, is active, and belongs to `projectId` - used to validate a
   * task's fixVersions/affectsVersions in one round trip rather than one query per id. */
  async findManyActiveInProject(ids: string[], projectId: string): Promise<ReleaseDocument[]> {
    if (ids.length === 0) return [];
    return this.model
      .find({
        _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
        project: new Types.ObjectId(projectId),
        deletedAt: null,
      })
      .exec();
  }

  async paginate(
    projectId: string,
    query: ListReleasesDto,
  ): Promise<{ data: ReleaseDocument[]; total: number }> {
    const filter: FilterQuery<ReleaseDocument> = {
      project: new Types.ObjectId(projectId),
      deletedAt: null,
    };
    if (query.status?.length) filter.status = { $in: query.status };

    const skip = (query.page - 1) * query.limit;
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ releaseDate: 1, createdAt: 1 })
        .skip(skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async updateById(id: string, update: Partial<Release>): Promise<ReleaseDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findByIdActive(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { deletedAt: new Date() }).exec();
  }
}
