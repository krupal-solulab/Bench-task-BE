import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { IssueTemplate, IssueTemplateDocument } from './schemas/issue-template.schema';

@Injectable()
export class IssueTemplatesRepository {
  constructor(
    @InjectModel(IssueTemplate.name)
    private readonly model: Model<IssueTemplateDocument>,
  ) {}

  create(data: Partial<IssueTemplate>): Promise<IssueTemplateDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<IssueTemplateDocument | null> {
    return this.model.findById(id).exec();
  }

  /** Every template in the org, or (with `projectId`) every org-wide template PLUS the ones
   * scoped to that specific project - the exact set a New Task form for that project may offer. */
  findForOrg(organizationId: string, projectId?: string): Promise<IssueTemplateDocument[]> {
    const filter: FilterQuery<IssueTemplate> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (projectId) {
      filter.$or = [{ projectId: null }, { projectId: new Types.ObjectId(projectId) }];
    }
    return this.model.find(filter).sort({ name: 1 }).exec();
  }

  async updateById(
    id: string,
    update: Partial<IssueTemplate>,
  ): Promise<IssueTemplateDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findById(id);
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
