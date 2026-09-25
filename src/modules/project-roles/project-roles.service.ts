import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { ProjectRolesRepository } from './project-roles.repository';
import { ProjectRoleDefinitionDocument } from './schemas/project-role-definition.schema';
import { CreateProjectRoleDto } from './dto/create-project-role.dto';
import { UpdateProjectRoleDto } from './dto/update-project-role.dto';

@Injectable()
export class ProjectRolesService {
  constructor(
    private readonly projectRolesRepository: ProjectRolesRepository,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
  ) {}

  async create(
    dto: CreateProjectRoleDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectRoleDefinitionDocument> {
    const organizationId = requireOrgId(actingUser);
    const name = dto.name.trim();
    if (await this.projectRolesRepository.nameExistsInOrg(organizationId, name)) {
      throw new BadRequestException(`A project role named "${name}" already exists`);
    }
    return this.projectRolesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name,
      description: dto.description ?? '',
    });
  }

  listMine(actingUser: AuthenticatedUser): Promise<ProjectRoleDefinitionDocument[]> {
    return this.projectRolesRepository.findByOrganization(requireOrgId(actingUser));
  }

  /** Used by ProjectsService when validating a Role Assignment's projectRoleId, and by Permission/
   * Security Scheme grant authoring - the caller's own organization boundary already establishes
   * trust, so no extra org check here. */
  findByIdOrNull(id: string): Promise<ProjectRoleDefinitionDocument | null> {
    return this.projectRolesRepository.findById(id);
  }

  async update(
    id: string,
    dto: UpdateProjectRoleDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectRoleDefinitionDocument> {
    const role = await this.getOwnedOrThrow(id, actingUser);
    const update: Partial<{ name: string; description: string }> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (
        await this.projectRolesRepository.nameExistsInOrg(extractId(role.organizationId), name, id)
      ) {
        throw new BadRequestException(`A project role named "${name}" already exists`);
      }
      update.name = name;
    }
    if (dto.description !== undefined) update.description = dto.description;
    return (await this.projectRolesRepository.updateById(id, update))!;
  }

  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    await this.getOwnedOrThrow(id, actingUser);
    const inUse = await this.projectModel.exists({
      'roleAssignments.projectRoleId': new Types.ObjectId(id),
    });
    if (inUse) {
      throw new BadRequestException(
        'This role is assigned on one or more projects - remove those assignments first',
      );
    }
    await this.projectRolesRepository.deleteById(id);
  }

  private async getOwnedOrThrow(
    id: string,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectRoleDefinitionDocument> {
    const role = await this.projectRolesRepository.findById(id);
    if (!role || extractId(role.organizationId) !== requireOrgId(actingUser)) {
      throw new NotFoundException('Project role not found');
    }
    return role;
  }
}
