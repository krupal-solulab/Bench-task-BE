import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ProjectRoleDefinition,
  ProjectRoleDefinitionDocument,
} from './schemas/project-role-definition.schema';

@Injectable()
export class ProjectRolesRepository {
  constructor(
    @InjectModel(ProjectRoleDefinition.name)
    private readonly model: Model<ProjectRoleDefinitionDocument>,
  ) {}

  create(data: Partial<ProjectRoleDefinition>): Promise<ProjectRoleDefinitionDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<ProjectRoleDefinitionDocument | null> {
    return this.model.findById(id).exec();
  }

  findByOrganization(organizationId: string): Promise<ProjectRoleDefinitionDocument[]> {
    return this.model
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ name: 1 })
      .exec();
  }

  nameExistsInOrg(organizationId: string, name: string, excludeId?: string): Promise<boolean> {
    return this.model
      .exists({
        organizationId: new Types.ObjectId(organizationId),
        name,
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      })
      .then(Boolean);
  }

  async updateById(
    id: string,
    update: Partial<ProjectRoleDefinition>,
  ): Promise<ProjectRoleDefinitionDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findById(id);
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
