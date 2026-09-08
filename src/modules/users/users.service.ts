import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig } from '../../config/configuration';
import { Role } from '../../common/enums/role.enum';
import { TaskStatus } from '../../common/enums/task-status.enum';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { extractId } from '../../common/utils/mongo.util';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { UsersRepository } from './users.repository';
import { UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ListUsersDto } from './dto/list-users.dto';

export interface UserWorkload {
  userId: string;
  name: string;
  total: number;
  todo: number;
  inProgress: number;
  review: number;
  done: number;
  overdue: number;
  completionRate: number;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
  ) {}

  async create(dto: CreateUserDto, organizationId: string): Promise<UserDocument> {
    await this.assertEmailAvailable(dto.email);
    const passwordHash = await this.hashPassword(dto.password);
    return this.usersRepository.create({
      name: dto.name,
      email: dto.email.toLowerCase(),
      passwordHash,
      role: dto.role,
      organizationId: new Types.ObjectId(organizationId),
    });
  }

  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.usersRepository.findByEmail(email);
  }

  async findByIdOrThrow(id: string): Promise<UserDocument> {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Same as findByIdOrThrow, but for admin-facing lookups of *another* user: throws
   * NotFoundException (not Forbidden) on a cross-org id, so a cross-org guess is
   * indistinguishable from "no such user at all" rather than confirming the id exists elsewhere.
   */
  async findByIdInOrgOrThrow(id: string, organizationId: string): Promise<UserDocument> {
    const user = await this.findByIdOrThrow(id);
    if (extractId(user.organizationId) !== organizationId) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async paginate(
    query: ListUsersDto,
    organizationId: string,
  ): Promise<PaginatedResponseDto<UserDocument>> {
    const { data, total } = await this.usersRepository.paginate(query, organizationId);
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async assignable(organizationId: string): Promise<UserDocument[]> {
    return this.usersRepository.findAssignable(organizationId);
  }

  async update(id: string, dto: UpdateUserDto, organizationId: string): Promise<UserDocument> {
    await this.findByIdInOrgOrThrow(id, organizationId);
    if (dto.email) await this.assertEmailAvailable(dto.email, id);
    const updated = await this.usersRepository.updateById(id, {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.email ? { email: dto.email.toLowerCase() } : {}),
    });
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async updateRole(
    id: string,
    role: Role,
    actingUserId: string,
    organizationId: string,
  ): Promise<UserDocument> {
    if (id === actingUserId) {
      throw new ConflictException('Admins cannot change their own role');
    }
    await this.findByIdInOrgOrThrow(id, organizationId);
    const updated = await this.usersRepository.updateById(id, { role });
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async updateStatus(
    id: string,
    isActive: boolean,
    actingUserId: string,
    organizationId: string,
  ): Promise<UserDocument> {
    if (id === actingUserId && !isActive) {
      throw new ConflictException('Admins cannot deactivate themselves');
    }
    await this.findByIdInOrgOrThrow(id, organizationId);
    const updated = await this.usersRepository.updateById(id, { isActive });
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async validatePassword(user: UserDocument, plain: string): Promise<boolean> {
    return bcrypt.compare(plain, user.passwordHash);
  }

  async setPassword(id: string, newPassword: string): Promise<void> {
    const passwordHash = await this.hashPassword(newPassword);
    await this.usersRepository.updateById(id, { passwordHash });
  }

  async getWorkload(userId: string, organizationId: string): Promise<UserWorkload> {
    const user = await this.findByIdInOrgOrThrow(userId, organizationId);
    const [facetResult] = await this.taskModel.aggregate([
      { $match: { assignee: new Types.ObjectId(userId), deletedAt: null } },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          total: [{ $count: 'count' }],
          overdue: [
            { $match: { dueDate: { $lt: new Date() }, status: { $ne: TaskStatus.DONE } } },
            { $count: 'count' },
          ],
        },
      },
    ]);

    const byStatus = (status: TaskStatus): number =>
      facetResult.byStatus.find((b: { _id: string }) => b._id === status)?.count ?? 0;
    const total = facetResult.total[0]?.count ?? 0;
    const done = byStatus(TaskStatus.DONE);

    return {
      userId: user.id,
      name: user.name,
      total,
      todo: byStatus(TaskStatus.TODO),
      inProgress: byStatus(TaskStatus.IN_PROGRESS),
      review: byStatus(TaskStatus.REVIEW),
      done,
      overdue: facetResult.overdue[0]?.count ?? 0,
      completionRate: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }

  private async hashPassword(plain: string): Promise<string> {
    const rounds = this.configService.get('bcryptSaltRounds', { infer: true });
    return bcrypt.hash(plain, rounds);
  }

  private async assertEmailAvailable(email: string, excludeId?: string): Promise<void> {
    const existing = await this.usersRepository.findByEmail(email);
    if (existing && existing.id !== excludeId) {
      throw new ConflictException('Email is already registered');
    }
  }
}
