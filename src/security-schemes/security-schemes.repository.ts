import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SecurityScheme, SecuritySchemeDocument } from './schemas/security-scheme.schema';

@Injectable()
export class SecuritySchemesRepository {
  constructor(
    @InjectModel(SecurityScheme.name)
    private readonly model: Model<SecuritySchemeDocument>,
  ) {}

  create(data: Partial<SecurityScheme>): Promise<SecuritySchemeDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<SecuritySchemeDocument | null> {
    return this.model.findById(id).exec();
  }

  findByOrganization(organizationId: string): Promise<SecuritySchemeDocument[]> {
    return this.model
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ name: 1 })
      .exec();
  }

  async updateById(
    id: string,
    update: Partial<SecurityScheme>,
  ): Promise<SecuritySchemeDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findById(id);
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
