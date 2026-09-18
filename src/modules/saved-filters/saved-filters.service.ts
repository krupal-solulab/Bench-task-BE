import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { SavedFiltersRepository } from './saved-filters.repository';
import {
  SavedFilterDocument,
  SavedFilterScope,
  SavedFilterVisibility,
} from './schemas/saved-filter.schema';
import { CreateSavedFilterDto } from './dto/create-saved-filter.dto';
import { ListSavedFiltersDto } from './dto/list-saved-filters.dto';

@Injectable()
export class SavedFiltersService {
  constructor(private readonly savedFiltersRepository: SavedFiltersRepository) {}

  async create(
    dto: CreateSavedFilterDto,
    actingUser: AuthenticatedUser,
  ): Promise<SavedFilterDocument> {
    if (dto.scope === SavedFilterScope.PROJECT && !dto.projectId) {
      throw new BadRequestException('projectId is required when scope is "project"');
    }
    const visibility = dto.visibility ?? SavedFilterVisibility.PRIVATE;
    if (visibility === SavedFilterVisibility.SHARED && dto.scope !== SavedFilterScope.PROJECT) {
      throw new BadRequestException('Only a "project"-scoped filter can be shared');
    }

    return this.savedFiltersRepository.create({
      owner: new Types.ObjectId(actingUser.id),
      organizationId: new Types.ObjectId(requireOrgId(actingUser)),
      name: dto.name.trim(),
      scope: dto.scope,
      projectId: dto.projectId ? new Types.ObjectId(dto.projectId) : null,
      visibility,
      query: dto.query,
    });
  }

  /**
   * The caller's own saved filters, plus - for `scope: PROJECT` only - any other member's
   * `SHARED` filter for that same project (Search/Dashboards v2). A `MY_TASKS` query, or one with
   * no scope at all, stays exactly as before this feature: owner-only.
   */
  list(query: ListSavedFiltersDto, actingUser: AuthenticatedUser): Promise<SavedFilterDocument[]> {
    return this.savedFiltersRepository.find(actingUser.id, {
      scope: query.scope,
      projectId: query.projectId,
    });
  }

  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    const filter = await this.savedFiltersRepository.findById(id);
    // Owner-only, even for a SHARED filter another project member can see and apply - never
    // distinguish "doesn't exist" from "exists but isn't yours" so a non-owner gets the same 404
    // either way rather than a signal that it exists at all. Not building: a Manager's override-
    // delete of someone else's shared filter (an unrequested ACL question - see the plan).
    if (!filter || extractId(filter.owner) !== actingUser.id) {
      throw new NotFoundException('Saved filter not found');
    }
    await this.savedFiltersRepository.deleteById(id);
  }
}
