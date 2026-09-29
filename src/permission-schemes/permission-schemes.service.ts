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
import { PermissionSchemesRepository } from './permission-schemes.repository';
import { PermissionGrant, PermissionSchemeDocument } from './schemas/permission-scheme.schema';
import { CreatePermissionSchemeDto } from './dto/create-permission-scheme.dto';
import { UpdatePermissionSchemeDto } from './dto/update-permission-scheme.dto';

@Injectable()
export class PermissionSchemesService {
  constructor(
    private readonly permissionSchemesRepository: PermissionSchemesRepository,
    private readonly usersRepository: UsersRepository,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Team.name) private readonly teamModel: Model<TeamDocument>,
    @InjectModel(ProjectRoleDefinition.name)
    private readonly projectRoleModel: Model<ProjectRoleDefinitionDocument>,
  ) {}

  async create(
    dto: CreatePermissionSchemeDto,
    actingUser: AuthenticatedUser,
  ): Promise<PermissionSchemeDocument> {
    const organizationId = requireOrgId(actingUser);
    const grants = await this.toGrants(dto.grants, organizationId);
    return this.permissionSchemesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: dto.name.trim(),
      grants,
    });
  }

  listMine(actingUser: AuthenticatedUser): Promise<PermissionSchemeDocument[]> {
    return this.permissionSchemesRepository.findByOrganization(requireOrgId(actingUser));
  }

  async update(
    id: string,
    dto: UpdatePermissionSchemeDto,
    actingUser: AuthenticatedUser,
  ): Promise<PermissionSchemeDocument> {
    const scheme = await this.getOwnedOrThrow(id, actingUser);
    const update: Partial<{ name: string; grants: PermissionGrant[] }> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.grants !== undefined) {
      update.grants = await this.toGrants(dto.grants, extractId(scheme.organizationId));
    }
    return (await this.permissionSchemesRepository.updateById(id, update))!;
  }

  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    await this.getOwnedOrThrow(id, actingUser);
    const inUse = await this.projectModel.exists({
      permissionSchemeId: new Types.ObjectId(id),
      deletedAt: null,
    });
    if (inUse) {
      throw new BadRequestException(
        'This scheme is assigned to one or more projects - unassign it from every project first',
      );
    }
    await this.permissionSchemesRepository.deleteById(id);
  }

  /** Used by ProjectsService when checking an action against a project's assigned scheme - the
   * project's own organization boundary already establishes trust, so no org re-check here. */
  findByIdOrNull(id: string): Promise<PermissionSchemeDocument | null> {
    return this.permissionSchemesRepository.findById(id);
  }

  private async getOwnedOrThrow(
    id: string,
    actingUser: AuthenticatedUser,
  ): Promise<PermissionSchemeDocument> {
    const scheme = await this.permissionSchemesRepository.findById(id);
    if (!scheme || extractId(scheme.organizationId) !== requireOrgId(actingUser)) {
      throw new NotFoundException('Permission scheme not found');
    }
    return scheme;
  }

  private async toGrants(
    dtoGrants: Array<{
      action: string;
      allowedRoles: string[];
      allowedUserIds: string[];
      allowedTeamIds?: string[];
      allowedProjectRoleIds?: string[];
    }>,
    organizationId: string,
  ): Promise<PermissionGrant[]> {
    const allUserIds = [...new Set(dtoGrants.flatMap((g) => g.allowedUserIds))];
    if (allUserIds.length > 0) {
      const users = await this.usersRepository.findByIds(allUserIds, organizationId);
      if (users.length !== allUserIds.length) {
        throw new BadRequestException(
          'One or more allowedUserIds do not exist in this organization',
        );
      }
    }

    const allTeamIds = [...new Set(dtoGrants.flatMap((g) => g.allowedTeamIds ?? []))];
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

    const allProjectRoleIds = [...new Set(dtoGrants.flatMap((g) => g.allowedProjectRoleIds ?? []))];
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

    return dtoGrants.map((g) => ({
      action: g.action,
      allowedRoles: g.allowedRoles,
      allowedUserIds: g.allowedUserIds.map((userId) => new Types.ObjectId(userId)),
      allowedTeamIds: (g.allowedTeamIds ?? []).map((teamId) => new Types.ObjectId(teamId)),
      allowedProjectRoleIds: (g.allowedProjectRoleIds ?? []).map(
        (roleId) => new Types.ObjectId(roleId),
      ),
    })) as PermissionGrant[];
  }
}
