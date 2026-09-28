import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  FieldPermissionScheme,
  FieldPermissionSchemeDocument,
} from './schemas/field-permission-scheme.schema';

@Injectable()
export class FieldPermissionSchemesRepository {
  constructor(
    @InjectModel(FieldPermissionScheme.name)
    private readonly model: Model<FieldPermissionSchemeDocument>,
  ) {}

  create(data: Partial<FieldPermissionScheme>): Promise<FieldPermissionSchemeDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<FieldPermissionSchemeDocument | null> {
    return this.model.findById(id).exec();
  }

  findByOrganization(organizationId: string): Promise<FieldPermissionSchemeDocument[]> {
    return this.model
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ name: 1 })
      .exec();
  }

  async updateById(
    id: string,
    update: Partial<FieldPermissionScheme>,
  ): Promise<FieldPermissionSchemeDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findById(id);
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
