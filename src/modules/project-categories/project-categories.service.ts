import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { ProjectCategory, ProjectCategoryDocument } from './schemas/project-category.schema';
import { CreateProjectCategoryDto } from './dto/create-project-category.dto';
import { UpdateProjectCategoryDto } from './dto/update-project-category.dto';

/** Mongo's duplicate-key error code - raised by the case-insensitive unique {org, name} index. */
const DUPLICATE_KEY = 11000;

@Injectable()
export class ProjectCategoriesService {
  constructor(
    @InjectModel(ProjectCategory.name)
    private readonly categoryModel: Model<ProjectCategoryDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
  ) {}

  list(actingUser: AuthenticatedUser): Promise<ProjectCategoryDocument[]> {
    return this.categoryModel
      .find({ organizationId: new Types.ObjectId(requireOrgId(actingUser)) })
      .collation({ locale: 'en', strength: 2 })
      .sort({ name: 1 })
      .exec();
  }

  async create(
    dto: CreateProjectCategoryDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectCategoryDocument> {
    try {
      return await this.categoryModel.create({
        organizationId: new Types.ObjectId(requireOrgId(actingUser)),
        name: dto.name.trim(),
        description: dto.description ?? '',
      });
    } catch (err) {
      throw this.mapDuplicate(err, dto.name);
    }
  }

  async update(
    id: string,
    dto: UpdateProjectCategoryDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectCategoryDocument> {
    await this.getInOrgOrThrow(id, requireOrgId(actingUser));
    try {
      const updated = await this.categoryModel
        .findByIdAndUpdate(
          id,
          {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
          },
          { new: true, runValidators: true },
        )
        .exec();
      return updated!;
    } catch (err) {
      throw this.mapDuplicate(err, dto.name ?? '');
    }
  }

  /** Blocked while any non-deleted project still uses it - same convention as the org schemes,
   * so a project never silently loses its category. */
  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    await this.getInOrgOrThrow(id, requireOrgId(actingUser));
    const inUse = await this.projectModel.countDocuments({
      categoryId: new Types.ObjectId(id),
      deletedAt: null,
    });
    if (inUse > 0) {
      throw new ConflictException(
        `This category is used by ${inUse} project${inUse === 1 ? '' : 's'} - reassign them first`,
      );
    }
    await this.categoryModel.deleteOne({ _id: id }).exec();
  }

  findByIdOrNull(id: string): Promise<ProjectCategoryDocument | null> {
    return this.categoryModel.findById(id).exec();
  }

  private async getInOrgOrThrow(
    id: string,
    organizationId: string,
  ): Promise<ProjectCategoryDocument> {
    const category = await this.categoryModel.findById(id).exec();
    if (!category || extractId(category.organizationId) !== organizationId) {
      throw new NotFoundException('Project category not found');
    }
    return category;
  }

  private mapDuplicate(err: unknown, name: string): unknown {
    if ((err as { code?: number })?.code === DUPLICATE_KEY) {
      return new ConflictException(`A category named "${name.trim()}" already exists`);
    }
    return err;
  }
}
