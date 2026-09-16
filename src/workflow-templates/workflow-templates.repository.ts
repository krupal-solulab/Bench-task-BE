import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WorkflowTemplate, WorkflowTemplateDocument } from './schemas/workflow-template.schema';

@Injectable()
export class WorkflowTemplatesRepository {
  constructor(
    @InjectModel(WorkflowTemplate.name)
    private readonly model: Model<WorkflowTemplateDocument>,
  ) {}

  create(data: Partial<WorkflowTemplate>): Promise<WorkflowTemplateDocument> {
    return this.model.create(data);
  }

  insertMany(data: Partial<WorkflowTemplate>[]): Promise<WorkflowTemplateDocument[]> {
    return this.model.insertMany(data) as unknown as Promise<WorkflowTemplateDocument[]>;
  }

  findById(id: string): Promise<WorkflowTemplateDocument | null> {
    return this.model.findById(id).exec();
  }

  findAll(): Promise<WorkflowTemplateDocument[]> {
    return this.model.find().sort({ name: 1 }).exec();
  }

  count(): Promise<number> {
    return this.model.countDocuments().exec();
  }

  async updateById(
    id: string,
    update: Partial<WorkflowTemplate>,
  ): Promise<WorkflowTemplateDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findById(id);
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
