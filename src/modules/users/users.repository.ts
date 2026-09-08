import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { User, UserDocument } from './schemas/user.schema';
import { ListUsersDto } from './dto/list-users.dto';

@Injectable()
export class UsersRepository {
  constructor(@InjectModel(User.name) private readonly model: Model<UserDocument>) {}

  create(data: Partial<User>): Promise<UserDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.model.findById(id).exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.model.findOne({ email: email.toLowerCase() }).select('+passwordHash').exec();
  }

  findByIdWithPassword(id: string): Promise<UserDocument | null> {
    return this.model.findById(id).select('+passwordHash').exec();
  }

  async paginate(
    query: ListUsersDto,
    organizationId: string,
  ): Promise<{ data: UserDocument[]; total: number }> {
    const filter: FilterQuery<UserDocument> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { email: { $regex: query.search, $options: 'i' } },
      ];
    }
    if (query.role) filter.role = query.role;
    if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';

    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const skip = (query.page - 1) * query.limit;

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ [query.sortBy]: sortOrder })
        .skip(skip)
        .limit(query.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  findAssignable(organizationId: string): Promise<UserDocument[]> {
    return this.model
      .find({
        role: Role.DEVELOPER,
        isActive: true,
        organizationId: new Types.ObjectId(organizationId),
      })
      .sort({ name: 1 })
      .exec();
  }

  async updateById(id: string, update: Partial<User>): Promise<UserDocument | null> {
    return this.model.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  countByRole(role: Role, organizationId: string, activeOnly = false): Promise<number> {
    const filter: FilterQuery<UserDocument> = {
      role,
      organizationId: new Types.ObjectId(organizationId),
    };
    if (activeOnly) filter.isActive = true;
    return this.model.countDocuments(filter).exec();
  }

  findByIds(ids: string[], organizationId: string): Promise<UserDocument[]> {
    return this.model
      .find({ _id: { $in: ids }, organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  countByOrganization(organizationId: string): Promise<number> {
    return this.model.countDocuments({ organizationId: new Types.ObjectId(organizationId) }).exec();
  }

  countAll(): Promise<number> {
    return this.model.countDocuments().exec();
  }

  findAdminsByOrganization(organizationId: string): Promise<UserDocument[]> {
    return this.model
      .find({ organizationId: new Types.ObjectId(organizationId), role: Role.ADMIN })
      .sort({ createdAt: 1 })
      .exec();
  }
}
