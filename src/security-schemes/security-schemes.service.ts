import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { extractId } from '../common/utils/mongo.util';
import { requireOrgId } from '../common/utils/auth-user.util';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { UsersRepository } from '../modules/users/users.repository';
import { Project, ProjectDocument } from '../modules/projects/schemas/project.schema';
import { Team, TeamDocument } from '../modules/teams/schemas/team.schema';
import {
  ProjectRoleDefinition,
  ProjectRoleDefinitionDocument,
} from '../modules/project-roles/schemas/project-role-definition.schema';
import { SecuritySchemesRepository } from './security-schemes.repository';
import { SecurityLevel, SecuritySchemeDocument } from './schemas/security-scheme.schema';
import { CreateSecuritySchemeDto } from './dto/create-security-scheme.dto';
import { UpdateSecuritySchemeDto } from './dto/update-security-scheme.dto';

@Injectable()
export class SecuritySchemesService {
  constructor(
    private readonly securitySchemesRepository: SecuritySchemesRepository,
    private readonly usersRepository: UsersRepository,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(ProjectRoleDefinition.name)
    private readonly projectRoleModel: Model<ProjectRoleDefinitionDocument>,
  ) {}

  async create(
    dto: CreateSecuritySchemeDto,
    actingUser: AuthenticatedUser,
  ): Promise<SecuritySchemeDocument> {
    const organizationId = requireOrgId(actingUser);
    const levels = await this.toLevels(dto.levels, organizationId);
    return this.securitySchemesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: dto.name.trim(),
      levels,
    });
  }

  listMine(actingUser: AuthenticatedUser): Promise<SecuritySchemeDocument[]> {
    return this.securitySchemesRepository.findByOrganization(requireOrgId(actingUser));
  }

  async update(
    id: string,
    dto: UpdateSecuritySchemeDto,
    actingUser: AuthenticatedUser,
  ): Promise<SecuritySchemeDocument> {
    const scheme = await this.getOwnedOrThrow(id, actingUser);
    const update: Partial<{ name: string; levels: SecurityLevel[] }> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.levels !== undefined) {
      update.levels = await this.toLevels(dto.levels, extractId(scheme.organizationId));
    }
    return (await this.securitySchemesRepository.updateById(id, update))!;
  }

  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    await this.getOwnedOrThrow(id, actingUser);
    const inUse = await this.projectModel.exists({ securitySchemeId: new Types.ObjectId(id) });
    if (inUse) {
      throw new BadRequestException(
        'This scheme is assigned to one or more projects - unassign it from every project first',
      );
    }
    await this.securitySchemesRepository.deleteById(id);
  }

  /** Used by ProjectsService when assigning a scheme, and by TasksService when resolving which
   * security levels the acting user may view - the project's own organization boundary already
   * establishes trust, so no extra org check here. */
  findByIdOrNull(id: string): Promise<SecuritySchemeDocument | null> {
    return this.securitySchemesRepository.findById(id);
  }

  private async getOwnedOrThrow(
    id: string,
    actingUser: AuthenticatedUser,
  ): Promise<SecuritySchemeDocument> {
    const scheme = await this.securitySchemesRepository.findById(id);
    if (!scheme || extractId(scheme.organizationId) !== requireOrgId(actingUser)) {
      throw new NotFoundException('Security scheme not found');
    }
    return scheme;
  }

  private async toLevels(
    dtoLevels: Array<{
      name: string;
      allowedRoles: string[];
      allowedUserIds: string[];
      allowedTeamIds?: string[];
      allowedProjectRoleIds?: string[];
    }>,
    organizationId: string,
  ): Promise<SecurityLevel[]> {
    const names = dtoLevels.map((l) => l.name.trim());
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Each security level name must be unique within a scheme');
    }

    const allUserIds = [...new Set(dtoLevels.flatMap((l) => l.allowedUserIds))];
    if (allUserIds.length > 0) {
      const users = await this.usersRepository.findByIds(allUserIds, organizationId);
      if (users.length !== allUserIds.length) {
        throw new BadRequestException(
          'One or more allowedUserIds do not exist in this organization',
        );
      }
    }

    const allTeamIds = [...new Set(dtoLevels.flatMap((l) => l.allowedTeamIds ?? []))];
    if (allTeamIds.length > 0) {
      const teamCount = await this.teamModel.countDocuments({
        _id: { $in: allTeamIds },
        organizationId: new Types.ObjectId(organizationId),
      });
      if (teamCount !== allTeamIds.length) {
        throw new BadRequestException(
          'One or more allowedTeamIds do not exist in this organization',
        );
      }
    }

    const allProjectRoleIds = [...new Set(dtoLevels.flatMap((l) => l.allowedProjectRoleIds ?? []))];
    if (allProjectRoleIds.length > 0) {
      const roleCount = await this.projectRoleModel.countDocuments({
        _id: { $in: allProjectRoleIds },
        organizationId: new Types.ObjectId(organizationId),
      });
      if (roleCount !== allProjectRoleIds.length) {
        throw new BadRequestException(
          'One or more allowedProjectRoleIds do not exist in this organization',
        );
      }
    }

    return dtoLevels.map((l) => ({
      name: l.name.trim(),
      allowedRoles: l.allowedRoles,
      allowedUserIds: l.allowedUserIds.map((userId) => new Types.ObjectId(userId)),
      allowedTeamIds: (l.allowedTeamIds ?? []).map((teamId) => new Types.ObjectId(teamId)),
      allowedProjectRoleIds: (l.allowedProjectRoleIds ?? []).map(
        (roleId) => new Types.ObjectId(roleId),
      ),
    })) as SecurityLevel[];
  }
}
