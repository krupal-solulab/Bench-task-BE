import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { extractId } from '../common/utils/mongo.util';
import { requireOrgId } from '../common/utils/auth-user.util';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { Project, ProjectDocument } from '../modules/projects/schemas/project.schema';
import { FieldPermissionSchemesRepository } from './field-permission-schemes.repository';
import {
  FieldPermissionRule,
  FieldPermissionSchemeDocument,
} from './schemas/field-permission-scheme.schema';
import { CreateFieldPermissionSchemeDto } from './dto/create-field-permission-scheme.dto';
import { UpdateFieldPermissionSchemeDto } from './dto/update-field-permission-scheme.dto';

@Injectable()
export class FieldPermissionSchemesService {
  constructor(
    private readonly fieldPermissionSchemesRepository: FieldPermissionSchemesRepository,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
  ) {}

  async create(
    dto: CreateFieldPermissionSchemeDto,
    actingUser: AuthenticatedUser,
  ): Promise<FieldPermissionSchemeDocument> {
    const rules = this.toRules(dto.rules);
    return this.fieldPermissionSchemesRepository.create({
      organizationId: new Types.ObjectId(requireOrgId(actingUser)),
      name: dto.name.trim(),
      rules,
    });
  }

  listMine(actingUser: AuthenticatedUser): Promise<FieldPermissionSchemeDocument[]> {
    return this.fieldPermissionSchemesRepository.findByOrganization(requireOrgId(actingUser));
  }

  async update(
    id: string,
    dto: UpdateFieldPermissionSchemeDto,
    actingUser: AuthenticatedUser,
  ): Promise<FieldPermissionSchemeDocument> {
    await this.getOwnedOrThrow(id, actingUser);
    const update: Partial<{ name: string; rules: FieldPermissionRule[] }> = {};
    if (dto.name !== undefined) update.name = dto.name.trim();
    if (dto.rules !== undefined) update.rules = this.toRules(dto.rules);
    return (await this.fieldPermissionSchemesRepository.updateById(id, update))!;
  }

  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    await this.getOwnedOrThrow(id, actingUser);
    const inUse = await this.projectModel.exists({
      fieldPermissionSchemeId: new Types.ObjectId(id),
      deletedAt: null,
    });
    if (inUse) {
      throw new BadRequestException(
        'This scheme is assigned to one or more projects - unassign it from every project first',
      );
    }
    await this.fieldPermissionSchemesRepository.deleteById(id);
  }

  /** Used by ProjectsService when assigning a scheme, and by TasksService when resolving field
   * view/edit access - the project's own organization boundary already establishes trust. */
  findByIdOrNull(id: string): Promise<FieldPermissionSchemeDocument | null> {
    return this.fieldPermissionSchemesRepository.findById(id);
  }

  private async getOwnedOrThrow(
    id: string,
    actingUser: AuthenticatedUser,
  ): Promise<FieldPermissionSchemeDocument> {
    const scheme = await this.fieldPermissionSchemesRepository.findById(id);
    if (!scheme || extractId(scheme.organizationId) !== requireOrgId(actingUser)) {
      throw new NotFoundException('Field permission scheme not found');
    }
    return scheme;
  }

  private toRules(
    dtoRules: Array<{ fieldId: string; hiddenFromRoles: string[]; readOnlyForRoles: string[] }>,
  ): FieldPermissionRule[] {
    const ids = dtoRules.map((r) => r.fieldId.trim());
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Each fieldId must be unique within a scheme');
    }
    return dtoRules.map((r) => ({
      fieldId: r.fieldId.trim(),
      hiddenFromRoles: r.hiddenFromRoles,
      readOnlyForRoles: r.readOnlyForRoles,
    })) as FieldPermissionRule[];
  }
}
