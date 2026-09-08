import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { Role } from '../../common/enums/role.enum';
import { OrganizationStatus } from '../../common/enums/organization-status.enum';
import { UsersRepository } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { UserDocument } from '../users/schemas/user.schema';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationDocument } from './schemas/organization.schema';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ListOrganizationsDto } from './dto/list-organizations.dto';

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationDetail extends OrganizationSummary {
  admins: Array<{ id: string; name: string; email: string; isActive: boolean }>;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Creates a new organization plus its first Admin. There's no multi-document transaction here
   * (the target MongoDB is a standalone instance, not a replica set) - the two writes are
   * sequential, and the org is deleted if creating its admin fails, so a partial failure never
   * leaves an org with zero admins reachable through this path.
   */
  async createWithAdmin(
    dto: CreateOrganizationDto,
    createdBy: string | null,
  ): Promise<{ organization: OrganizationDocument; admin: UserDocument }> {
    const slug = await this.generateUniqueSlug(dto.organizationName);
    const organization = await this.organizationsRepository.create({
      name: dto.organizationName,
      slug,
      status: OrganizationStatus.ACTIVE,
      createdBy: createdBy ? new Types.ObjectId(createdBy) : null,
    });

    try {
      const admin = await this.usersService.create(
        {
          name: dto.adminName,
          email: dto.adminEmail,
          password: dto.adminPassword,
          role: Role.ADMIN,
        },
        organization.id,
      );
      return { organization, admin };
    } catch (err) {
      await this.organizationsRepository.deleteById(organization.id);
      throw err;
    }
  }

  async addAdmin(
    organizationId: string,
    dto: { name: string; email: string; password: string },
  ): Promise<UserDocument> {
    await this.getActiveOrThrow(organizationId);
    return this.usersService.create(
      { name: dto.name, email: dto.email, password: dto.password, role: Role.ADMIN },
      organizationId,
    );
  }

  async list(query: ListOrganizationsDto): Promise<PaginatedResponseDto<OrganizationSummary>> {
    const { data, total } = await this.organizationsRepository.paginate(query);
    const summaries = await Promise.all(data.map((org) => this.toSummary(org)));
    return { data: summaries, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async getDetail(id: string): Promise<OrganizationDetail> {
    const organization = await this.getOrThrow(id);
    const summary = await this.toSummary(organization);
    const admins = await this.usersRepository.findAdminsByOrganization(id);
    return {
      ...summary,
      admins: admins.map((a) => ({ id: a.id, name: a.name, email: a.email, isActive: a.isActive })),
    };
  }

  async rename(id: string, name: string): Promise<OrganizationSummary> {
    const updated = await this.organizationsRepository.updateById(id, { name });
    if (!updated) throw new NotFoundException('Organization not found');
    return this.toSummary(updated);
  }

  async setStatus(id: string, status: OrganizationStatus): Promise<OrganizationSummary> {
    const updated = await this.organizationsRepository.updateById(id, {
      status,
      suspendedAt: status === OrganizationStatus.SUSPENDED ? new Date() : null,
    });
    if (!updated) throw new NotFoundException('Organization not found');
    return this.toSummary(updated);
  }

  /**
   * The one legitimate platform-wide aggregate a PlatformAdmin is allowed to see (decision:
   * org/user counts only, never project/task content) - deliberately implemented with its own
   * unscoped count methods rather than reusing the org-scoped paginate()/countByOrganization().
   */
  async stats(): Promise<{ organizationCount: number; totalUserCount: number }> {
    const [organizationCount, totalUserCount] = await Promise.all([
      this.organizationsRepository.countAll(),
      this.usersRepository.countAll(),
    ]);
    return { organizationCount, totalUserCount };
  }

  async assertActive(organizationId: string | null): Promise<void> {
    if (!organizationId) return;
    const organization = await this.organizationsRepository.findById(organizationId);
    if (organization && organization.status === OrganizationStatus.SUSPENDED) {
      throw new ForbiddenException('Organization is suspended');
    }
  }

  private async getOrThrow(id: string): Promise<OrganizationDocument> {
    const organization = await this.organizationsRepository.findById(id);
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  private async getActiveOrThrow(id: string): Promise<OrganizationDocument> {
    const organization = await this.getOrThrow(id);
    if (organization.status === OrganizationStatus.SUSPENDED) {
      throw new BadRequestException('Cannot add an admin to a suspended organization');
    }
    return organization;
  }

  private async toSummary(organization: OrganizationDocument): Promise<OrganizationSummary> {
    const userCount = await this.usersRepository.countByOrganization(organization.id);
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      userCount,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    };
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 100);
    const candidateBase = base || 'organization';

    let candidate = candidateBase;
    let suffix = 1;
    while (await this.organizationsRepository.findBySlug(candidate)) {
      suffix += 1;
      candidate = `${candidateBase}-${suffix}`;
    }
    return candidate;
  }
}
