import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CannedResponse, CannedResponseDocument } from './schemas/canned-response.schema';

@Injectable()
export class CannedResponsesRepository {
  constructor(
    @InjectModel(CannedResponse.name) private readonly model: Model<CannedResponseDocument>,
  ) {}

  create(data: Partial<CannedResponse>): Promise<CannedResponseDocument> {
    return this.model.create(data);
  }

  /** Every canned response in the org, shared - never filtered by createdBy. */
  findAllForOrg(organizationId: string): Promise<CannedResponseDocument[]> {
    return this.model
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ title: 1 })
      .exec();
  }

  /** Scoped to the org so one org can never read/update/delete another org's snippet by id. */
  findByIdInOrg(id: string, organizationId: string): Promise<CannedResponseDocument | null> {
    return this.model
      .findOne({ _id: id, organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  async updateById(
    id: string,
    update: Partial<Pick<CannedResponse, 'title' | 'body'>>,
  ): Promise<CannedResponseDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.model.findById(id).exec();
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
