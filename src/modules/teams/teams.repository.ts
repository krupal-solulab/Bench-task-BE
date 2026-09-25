import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Team, TeamDocument } from './schemas/team.schema';

@Injectable()
export class TeamsRepository {
  constructor(@InjectModel(Team.name) private readonly model: Model<TeamDocument>) {}

  create(data: Partial<Team>): Promise<TeamDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<TeamDocument | null> {
    return this.model
      .findById(id)
      .populate('leadId', 'name email')
      .populate('memberIds', 'name email')
      .exec();
  }

  findByOrganization(organizationId: string): Promise<TeamDocument[]> {
    return this.model
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .populate('leadId', 'name email')
      .populate('memberIds', 'name email')
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

  async updateById(id: string, update: Partial<Team>): Promise<TeamDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findById(id);
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }

  /** The ids of every team a user belongs to, within their org - used to resolve team-based grants
   * in Permission/Security Scheme checks and project Role Assignments. */
  async findTeamIdsForUser(organizationId: string, userId: string): Promise<string[]> {
    const teams = await this.model
      .find({
        organizationId: new Types.ObjectId(organizationId),
        memberIds: new Types.ObjectId(userId),
      })
      .select('_id')
      .exec();
    return teams.map((t) => t.id as string);
  }

  countInOrg(ids: string[], organizationId: string): Promise<number> {
    return this.model.countDocuments({
      _id: { $in: [...new Set(ids)] },
      organizationId: new Types.ObjectId(organizationId),
    });
  }
}
