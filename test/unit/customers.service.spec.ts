import { ConflictException, NotFoundException } from '@nestjs/common';
import { CustomersService } from 'src/modules/customers/customers.service';
import { CustomersRepository } from 'src/modules/customers/customers.repository';
import { CustomerTier } from 'src/common/enums/customer-tier.enum';
import { Role } from 'src/common/enums/role.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';

const ORG_A = '507f1f77bcf86cd799439010';
const ORG_B = '507f1f77bcf86cd799439099';
const CUSTOMER_ID = '507f1f77bcf86cd799439013';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'u-1',
    email: 'agent@a.com',
    role: Role.MANAGER,
    organizationId: ORG_A,
    ...overrides,
  };
}

describe('CustomersService', () => {
  let customersRepository: jest.Mocked<
    Pick<CustomersRepository, 'create' | 'findByEmail' | 'findById' | 'paginate'>
  >;
  let service: CustomersService;

  beforeEach(() => {
    customersRepository = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      paginate: jest.fn(),
    };
    service = new CustomersService(customersRepository as unknown as CustomersRepository);
  });

  describe('create', () => {
    it('rejects a duplicate email within the same org', async () => {
      customersRepository.findByEmail.mockResolvedValue({ id: CUSTOMER_ID } as never);

      await expect(
        service.create({ email: 'dana@customer.com', name: 'Dana' } as never, makeUser()),
      ).rejects.toThrow(ConflictException);
      expect(customersRepository.create).not.toHaveBeenCalled();
    });

    it('lowercases and trims the email before storing', async () => {
      customersRepository.findByEmail.mockResolvedValue(null);
      customersRepository.create.mockResolvedValue({ id: CUSTOMER_ID } as never);

      await service.create(
        { email: '  Dana@Customer.com  ', name: 'Dana', tier: CustomerTier.ENTERPRISE } as never,
        makeUser(),
      );

      expect(customersRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'dana@customer.com', tier: CustomerTier.ENTERPRISE }),
      );
    });
  });

  describe('findOrCreateByEmail', () => {
    it('returns the existing customer instead of creating a duplicate', async () => {
      const existing = { id: CUSTOMER_ID } as never;
      customersRepository.findByEmail.mockResolvedValue(existing);

      const result = await service.findOrCreateByEmail(ORG_A, 'dana@customer.com', 'Dana');

      expect(result).toBe(existing);
      expect(customersRepository.create).not.toHaveBeenCalled();
    });

    it('creates a new customer when none exists for that email in this org', async () => {
      customersRepository.findByEmail.mockResolvedValue(null);
      customersRepository.create.mockResolvedValue({ id: CUSTOMER_ID } as never);

      await service.findOrCreateByEmail(ORG_A, 'new@customer.com', 'New Customer');

      expect(customersRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@customer.com', name: 'New Customer' }),
      );
    });
  });

  describe('getActiveOrThrow', () => {
    it('rejects a customer belonging to a different organization', async () => {
      customersRepository.findById.mockResolvedValue({
        organizationId: { toString: () => ORG_B },
      } as never);

      await expect(service.getActiveOrThrow(CUSTOMER_ID, makeUser())).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
