import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { CustomFieldType } from '../projects/schemas/custom-field.schema';
import { ProjectResponse, ProjectsService } from '../projects/projects.service';
import {
  CustomFieldLibraryEntry,
  CustomFieldLibraryEntryDocument,
} from './schemas/custom-field-library-entry.schema';
import {
  AdoptLibraryFieldDto,
  CreateCustomFieldLibraryEntryDto,
  UpdateCustomFieldLibraryEntryDto,
} from './dto/custom-field-library.dto';

/** Mongo's duplicate-key error code - raised by the case-insensitive unique {org, name} index. */
const DUPLICATE_KEY = 11000;
/** Mirrors PutCustomFieldsDto's per-project cap. */
const MAX_FIELDS_PER_PROJECT = 50;

export type CustomFieldLibraryEntryWithUsage = ReturnType<
  CustomFieldLibraryEntryDocument['toJSON']
> & {
  projectCount: number;
};

@Injectable()
export class CustomFieldLibraryService {
  constructor(
    @InjectModel(CustomFieldLibraryEntry.name)
    private readonly entryModel: Model<CustomFieldLibraryEntryDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    private readonly projectsService: ProjectsService,
  ) {}

  async list(actingUser: AuthenticatedUser): Promise<CustomFieldLibraryEntryWithUsage[]> {
    const organizationId = new Types.ObjectId(requireOrgId(actingUser));
    const entries = await this.entryModel
      .find({ organizationId })
      .collation({ locale: 'en', strength: 2 })
      .sort({ name: 1 })
      .exec();
    if (entries.length === 0) return [];
    const usage = await this.projectModel.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          organizationId,
          deletedAt: null,
          'customFields.id': { $in: entries.map((e) => e.id) },
        },
      },
      { $unwind: '$customFields' },
      { $match: { 'customFields.id': { $in: entries.map((e) => e.id) } } },
      { $group: { _id: '$customFields.id', count: { $sum: 1 } } },
    ]);
    const countById = new Map(usage.map((u) => [u._id, u.count]));
    return entries.map((e) => ({ ...e.toJSON(), projectCount: countById.get(e.id) ?? 0 }));
  }

  async create(
    dto: CreateCustomFieldLibraryEntryDto,
    actingUser: AuthenticatedUser,
  ): Promise<CustomFieldLibraryEntryDocument> {
    try {
      return await this.entryModel.create({
        organizationId: new Types.ObjectId(requireOrgId(actingUser)),
        name: dto.name.trim(),
        type: dto.type,
        options: this.hasOptions(dto.type) ? dto.options! : null,
        description: dto.description ?? '',
      });
    } catch (err) {
      throw this.mapDuplicate(err, dto.name);
    }
  }

  /**
   * Renames / re-options a library field AND every adopting project's copy, so the definition
   * stays one org-wide thing. A rename that would collide with a different field's name in any
   * adopting project is refused up front rather than half-applied.
   */
  async update(
    id: string,
    dto: UpdateCustomFieldLibraryEntryDto,
    actingUser: AuthenticatedUser,
  ): Promise<CustomFieldLibraryEntryDocument> {
    const organizationId = requireOrgId(actingUser);
    const entry = await this.getInOrgOrThrow(id, organizationId);
    if (dto.options !== undefined && !this.hasOptions(entry.type)) {
      throw new BadRequestException('Only Dropdown and MultiSelect fields have options');
    }
    const name = dto.name?.trim();

    if (name && name.toLowerCase() !== entry.name.toLowerCase()) {
      const clashes = await this.projectModel.countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        deletedAt: null,
        'customFields.id': entry.id,
        customFields: {
          $elemMatch: {
            id: { $ne: entry.id },
            name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
          },
        },
      });
      if (clashes > 0) {
        throw new ConflictException(
          `${clashes} project(s) using this field already have another field named "${name}"`,
        );
      }
    }

    let updated: CustomFieldLibraryEntryDocument | null;
    try {
      updated = await this.entryModel
        .findByIdAndUpdate(
          id,
          {
            ...(name !== undefined ? { name } : {}),
            ...(dto.options !== undefined ? { options: dto.options } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
          },
          { new: true, runValidators: true },
        )
        .exec();
    } catch (err) {
      throw this.mapDuplicate(err, name ?? '');
    }

    const propagated = {
      ...(name !== undefined ? { 'customFields.$[field].name': name } : {}),
      ...(dto.options !== undefined ? { 'customFields.$[field].options': dto.options } : {}),
    };
    if (Object.keys(propagated).length > 0) {
      await this.projectModel
        .updateMany(
          { organizationId: new Types.ObjectId(organizationId), 'customFields.id': entry.id },
          { $set: propagated },
          { arrayFilters: [{ 'field.id': entry.id }] },
        )
        .exec();
    }
    return updated!;
  }

  /** Blocked while any non-deleted project still uses it - removing the field from a project
   * goes through that project's own custom-field settings (and its in-use-value guard). */
  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    const organizationId = requireOrgId(actingUser);
    const entry = await this.getInOrgOrThrow(id, organizationId);
    const inUse = await this.projectModel.countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      deletedAt: null,
      'customFields.id': entry.id,
    });
    if (inUse > 0) {
      throw new ConflictException(
        `This field is used by ${inUse} project${inUse === 1 ? '' : 's'} - remove it from them first`,
      );
    }
    await this.entryModel.deleteOne({ _id: id }).exec();
  }

  /** Adds a library field to one project, keeping the library entry's id as the field id. */
  async adoptIntoProject(
    projectId: string,
    entryId: string,
    dto: AdoptLibraryFieldDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanManage(project, actingUser);
    this.projectsService.assertProjectWritable(project);
    const entry = await this.getInOrgOrThrow(entryId, extractId(project.organizationId));

    if (project.customFields.some((f) => f.id === entry.id)) {
      throw new ConflictException(`"${entry.name}" is already on this project`);
    }
    if (project.customFields.some((f) => f.name.toLowerCase() === entry.name.toLowerCase())) {
      throw new ConflictException(`This project already has a field named "${entry.name}"`);
    }
    if (project.customFields.length >= MAX_FIELDS_PER_PROJECT) {
      throw new BadRequestException(
        `A project can have at most ${MAX_FIELDS_PER_PROJECT} custom fields`,
      );
    }

    await this.projectModel
      .updateOne(
        { _id: project._id },
        {
          $push: {
            customFields: {
              id: entry.id,
              name: entry.name,
              type: entry.type,
              required: dto.required ?? false,
              options: entry.options,
            },
          },
        },
      )
      .exec();
    return this.projectsService.findOneScoped(projectId, actingUser);
  }

  findByIdOrNull(id: string): Promise<CustomFieldLibraryEntryDocument | null> {
    return this.entryModel.findById(id).exec();
  }

  private async getInOrgOrThrow(
    id: string,
    organizationId: string,
  ): Promise<CustomFieldLibraryEntryDocument> {
    const entry = await this.entryModel.findById(id).exec();
    if (!entry || extractId(entry.organizationId) !== organizationId) {
      throw new NotFoundException('Library field not found');
    }
    return entry;
  }

  private hasOptions(type: CustomFieldType): boolean {
    return type === CustomFieldType.DROPDOWN || type === CustomFieldType.MULTI_SELECT;
  }

  private mapDuplicate(err: unknown, name: string): unknown {
    if ((err as { code?: number })?.code === DUPLICATE_KEY) {
      return new ConflictException(`A library field named "${name.trim()}" already exists`);
    }
    return err;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
