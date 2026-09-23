import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Customer, CustomerDocument } from './schemas/customer.schema';

@Injectable()
export class CustomersRepository {
  constructor(@InjectModel(Customer.name) private readonly model: Model<CustomerDocument>) {}

  create(data: Partial<Customer>): Promise<CustomerDocument> {
    return this.model.create(data);
  }

  findById(id: string): Promise<CustomerDocument | null> {
    return this.model.findById(id).exec();
  }

  findByEmail(organizationId: string, email: string): Promise<CustomerDocument | null> {
    return this.model
      .findOne({ organizationId: new Types.ObjectId(organizationId), email: email.toLowerCase() })
      .exec();
  }

  async paginate(
    organizationId: string,
    query: { page: number; limit: number; search?: string },
  ): Promise<{ data: CustomerDocument[]; total: number }> {
    const filter: FilterQuery<CustomerDocument> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (query.search) {
      const pattern = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { email: { $regex: pattern, $options: 'i' } },
        { name: { $regex: pattern, $options: 'i' } },
      ];
    }

    const skip = (query.page - 1) * query.limit;
    const [data, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }
}
