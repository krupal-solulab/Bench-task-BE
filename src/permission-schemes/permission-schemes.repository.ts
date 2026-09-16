import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PermissionScheme, PermissionSchemeDocument } from './schemas/permission-scheme.schema';

@Injectable()
export class PermissionSchemesRepository {
  constructor(
    @InjectModel(PermissionScheme.name)
    private readonly model: Model<PermissionSchemeDocument>,
  ) {}

  create(data: Partial<PermissionScheme>): Promise<PermissionSchemeDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<PermissionSchemeDocument | null> {
    return this.model.findById(id).exec();
  }

  findByOrganization(organizationId: string): Promise<PermissionSchemeDocument[]> {
    return this.model
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ name: 1 })
      .exec();
  }

  async updateById(
    id: string,
    update: Partial<PermissionScheme>,
  ): Promise<PermissionSchemeDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findById(id);
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
