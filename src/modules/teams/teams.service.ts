import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UsersRepository } from '../users/users.repository';
import { TeamsRepository } from './teams.repository';
import { TeamDocument } from './schemas/team.schema';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@Injectable()
export class TeamsService {
  constructor(
    private readonly teamsRepository: TeamsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async create(dto: CreateTeamDto, actingUser: AuthenticatedUser): Promise<TeamDocument> {
    const organizationId = requireOrgId(actingUser);
    const name = dto.name.trim();
    if (await this.teamsRepository.nameExistsInOrg(organizationId, name)) {
      throw new BadRequestException(`A team named "${name}" already exists`);
    }
    if (dto.leadId) await this.assertUsersExistInOrg([dto.leadId], organizationId);
    if (dto.memberIds?.length) await this.assertUsersExistInOrg(dto.memberIds, organizationId);

    const created = await this.teamsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name,
      description: dto.description ?? '',
      leadId: dto.leadId ? new Types.ObjectId(dto.leadId) : null,
      memberIds: (dto.memberIds ?? []).map((id) => new Types.ObjectId(id)),
    });
    // Re-fetched so the response has lead/member names populated, same as list/get - the plain
    // create() result above only has raw ObjectId refs.
    return (await this.teamsRepository.findById(created.id))!;
  }

  listMine(actingUser: AuthenticatedUser): Promise<TeamDocument[]> {
    return this.teamsRepository.findByOrganization(requireOrgId(actingUser));
  }

  async getOwnedOrThrow(id: string, actingUser: AuthenticatedUser): Promise<TeamDocument> {
    const team = await this.teamsRepository.findById(id);
    if (!team || extractId(team.organizationId) !== requireOrgId(actingUser)) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  async update(
    id: string,
    dto: UpdateTeamDto,
    actingUser: AuthenticatedUser,
  ): Promise<TeamDocument> {
    const team = await this.getOwnedOrThrow(id, actingUser);
    const organizationId = extractId(team.organizationId);
    const update: Partial<{
      name: string;
      description: string;
      leadId: Types.ObjectId | null;
      memberIds: Types.ObjectId[];
    }> = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (await this.teamsRepository.nameExistsInOrg(organizationId, name, id)) {
        throw new BadRequestException(`A team named "${name}" already exists`);
      }
      update.name = name;
    }
    if (dto.description !== undefined) update.description = dto.description;
    if (dto.leadId !== undefined) {
      if (dto.leadId) await this.assertUsersExistInOrg([dto.leadId], organizationId);
      update.leadId = dto.leadId ? new Types.ObjectId(dto.leadId) : null;
    }
    if (dto.memberIds !== undefined) {
      if (dto.memberIds.length) await this.assertUsersExistInOrg(dto.memberIds, organizationId);
      update.memberIds = dto.memberIds.map((memberId) => new Types.ObjectId(memberId));
    }

    return (await this.teamsRepository.updateById(id, update))!;
  }

  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    await this.getOwnedOrThrow(id, actingUser);
    await this.teamsRepository.deleteById(id);
  }

  /** Used by Permission/Security Scheme grant-checking and Role Assignment resolution - the
   * project's own organization boundary already establishes trust, so no extra org check here. */
  findTeamIdsForUser(organizationId: string, userId: string): Promise<string[]> {
    return this.teamsRepository.findTeamIdsForUser(organizationId, userId);
  }

  /** Used by ProjectsService.setRoleAssignment to validate a Role Assignment's teamIds all belong
   * to the acting user's organization. */
  countTeamsInOrg(ids: string[], organizationId: string): Promise<number> {
    return this.teamsRepository.countInOrg(ids, organizationId);
  }

  private async assertUsersExistInOrg(userIds: string[], organizationId: string): Promise<void> {
    const unique = [...new Set(userIds)];
    const users = await this.usersRepository.findByIds(unique, organizationId);
    if (users.length !== unique.length) {
      throw new BadRequestException('One or more users do not exist in this organization');
    }
  }
}
