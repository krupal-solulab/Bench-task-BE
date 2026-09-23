import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { CustomersRepository } from './customers.repository';
import { CustomerDocument } from './schemas/customer.schema';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersDto } from './dto/list-customers.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly customersRepository: CustomersRepository) {}

  async create(dto: CreateCustomerDto, actingUser: AuthenticatedUser): Promise<CustomerDocument> {
    const organizationId = requireOrgId(actingUser);
    const existing = await this.customersRepository.findByEmail(organizationId, dto.email);
    if (existing) {
      throw new ConflictException('A customer with this email already exists in this org');
    }
    return this.customersRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      email: dto.email.toLowerCase().trim(),
      name: dto.name,
      tier: dto.tier,
    });
  }

  /**
   * Finds an existing customer by email within the org, or creates one - used by TicketsService
   * when staff file a ticket on a customer's behalf and only supply an email/name, so the same
   * customer's repeat tickets attach to one contact record rather than duplicating it.
   */
  async findOrCreateByEmail(
    organizationId: string,
    email: string,
    name: string,
  ): Promise<CustomerDocument> {
    const existing = await this.customersRepository.findByEmail(organizationId, email);
    if (existing) return existing;
    return this.customersRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      email: email.toLowerCase().trim(),
      name,
    });
  }

  async getActiveOrThrow(id: string, actingUser: AuthenticatedUser): Promise<CustomerDocument> {
    const customer = await this.customersRepository.findById(id);
    if (!customer || customer.organizationId.toString() !== requireOrgId(actingUser)) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  async paginate(query: ListCustomersDto, actingUser: AuthenticatedUser) {
    const organizationId = requireOrgId(actingUser);
    const { data, total } = await this.customersRepository.paginate(organizationId, {
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }
}
