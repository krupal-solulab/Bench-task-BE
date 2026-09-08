import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Organization, OrganizationDocument } from './schemas/organization.schema';
import { ListOrganizationsDto } from './dto/list-organizations.dto';

@Injectable()
export class OrganizationsRepository {
  constructor(
    @InjectModel(Organization.name) private readonly model: Model<OrganizationDocument>,
  ) {}

  create(data: Partial<Organization>): Promise<OrganizationDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<OrganizationDocument | null> {
    return this.model.findById(id).exec();
  }

  findBySlug(slug: string): Promise<OrganizationDocument | null> {
    return this.model.findOne({ slug }).exec();
  }

  async paginate(
    query: ListOrganizationsDto,
  ): Promise<{ data: OrganizationDocument[]; total: number }> {
    const filter: FilterQuery<OrganizationDocument> = {};
    if (query.search) filter.name = { $regex: query.search, $options: 'i' };
    if (query.status) filter.status = query.status;

    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ [query.sortBy]: sortOrder })
        .skip(skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async updateById(
    id: string,
    update: Partial<Organization>,
  ): Promise<OrganizationDocument | null> {
    return this.model.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }

  countAll(): Promise<number> {
    return this.model.countDocuments().exec();
  }
}
