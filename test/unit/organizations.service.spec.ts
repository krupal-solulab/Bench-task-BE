import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { OrganizationStatus } from 'src/common/enums/organization-status.enum';
import { OrganizationsService } from 'src/modules/organizations/organizations.service';
import { OrganizationsRepository } from 'src/modules/organizations/organizations.repository';
import { UsersRepository } from 'src/modules/users/users.repository';
import { UsersService } from 'src/modules/users/users.service';

function makeOrg(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'org-1',
    name: 'Acme',
    slug: 'acme',
    status: OrganizationStatus.ACTIVE,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as never;
}

describe('OrganizationsService', () => {
  let organizationsRepository: jest.Mocked<
    Pick<
      OrganizationsRepository,
      'create' | 'deleteById' | 'paginate' | 'findById' | 'updateById' | 'countAll' | 'findBySlug'
    >
  >;
  let usersRepository: jest.Mocked<
    Pick<UsersRepository, 'countByOrganization' | 'countAll' | 'findAdminsByOrganization'>
  >;
  let usersService: jest.Mocked<Pick<UsersService, 'create'>>;
  let service: OrganizationsService;

  beforeEach(() => {
    organizationsRepository = {
      create: jest.fn(),
      deleteById: jest.fn(),
      paginate: jest.fn(),
      findById: jest.fn(),
      updateById: jest.fn(),
      countAll: jest.fn(),
      findBySlug: jest.fn(),
    };
    usersRepository = {
      countByOrganization: jest.fn().mockResolvedValue(0),
      countAll: jest.fn(),
      findAdminsByOrganization: jest.fn(),
    };
    usersService = { create: jest.fn() };
    service = new OrganizationsService(
      organizationsRepository as unknown as OrganizationsRepository,
      usersRepository as unknown as UsersRepository,
      usersService as unknown as UsersService,
    );
  });

  describe('createWithAdmin', () => {
    it('creates the organization then its first Admin', async () => {
      organizationsRepository.findBySlug.mockResolvedValue(null);
      organizationsRepository.create.mockResolvedValue(makeOrg());
      usersService.create.mockResolvedValue({ id: 'user-1' } as never);

      const result = await service.createWithAdmin(
        {
          organizationName: 'Acme',
          adminName: 'Ann Admin',
          adminEmail: 'ann@acme.com',
          adminPassword: 'Password123',
        },
        null,
      );

      expect(organizationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Acme', slug: 'acme', status: OrganizationStatus.ACTIVE }),
      );
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: Role.ADMIN, email: 'ann@acme.com' }),
        'org-1',
      );
      expect(result.organization.id).toBe('org-1');
      expect(result.admin.id).toBe('user-1');
    });

    it('deletes the just-created organization if creating its admin fails, and rethrows', async () => {
      organizationsRepository.findBySlug.mockResolvedValue(null);
      organizationsRepository.create.mockResolvedValue(makeOrg());
      const failure = new BadRequestException('email already in use');
      usersService.create.mockRejectedValue(failure);

      await expect(
        service.createWithAdmin(
          {
            organizationName: 'Acme',
            adminName: 'Ann Admin',
            adminEmail: 'ann@acme.com',
            adminPassword: 'Password123',
          },
          null,
        ),
      ).rejects.toBe(failure);

      expect(organizationsRepository.deleteById).toHaveBeenCalledWith('org-1');
    });

    it('appends a numeric suffix to the slug when the base slug is already taken', async () => {
      organizationsRepository.findBySlug
        .mockResolvedValueOnce(makeOrg({ slug: 'acme' }))
        .mockResolvedValueOnce(null);
      organizationsRepository.create.mockResolvedValue(makeOrg({ slug: 'acme-2' }));
      usersService.create.mockResolvedValue({ id: 'user-1' } as never);

      await service.createWithAdmin(
        {
          organizationName: 'Acme',
          adminName: 'Ann Admin',
          adminEmail: 'ann@acme.com',
          adminPassword: 'Password123',
        },
        null,
      );

      expect(organizationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'acme-2' }),
      );
    });
  });

  describe('addAdmin', () => {
    it('adds an admin to an active organization', async () => {
      organizationsRepository.findById.mockResolvedValue(makeOrg());
      usersService.create.mockResolvedValue({ id: 'user-2' } as never);

      const admin = await service.addAdmin('org-1', {
        name: 'Bob',
        email: 'bob@acme.com',
        password: 'Password123',
      });

      expect(admin.id).toBe('user-2');
      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ role: Role.ADMIN }),
        'org-1',
      );
    });

    it('rejects adding an admin to a suspended organization', async () => {
      organizationsRepository.findById.mockResolvedValue(
        makeOrg({ status: OrganizationStatus.SUSPENDED }),
      );

      await expect(
        service.addAdmin('org-1', { name: 'Bob', email: 'bob@acme.com', password: 'Password123' }),
      ).rejects.toThrow(BadRequestException);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the organization does not exist', async () => {
      organizationsRepository.findById.mockResolvedValue(null);

      await expect(
        service.addAdmin('missing-org', {
          name: 'Bob',
          email: 'bob@acme.com',
          password: 'Password123',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setStatus', () => {
    it('stamps suspendedAt when suspending an organization', async () => {
      organizationsRepository.updateById.mockResolvedValue(
        makeOrg({ status: OrganizationStatus.SUSPENDED }),
      );

      await service.setStatus('org-1', OrganizationStatus.SUSPENDED);

      expect(organizationsRepository.updateById).toHaveBeenCalledWith('org-1', {
        status: OrganizationStatus.SUSPENDED,
        suspendedAt: expect.any(Date),
      });
    });

    it('clears suspendedAt when reactivating an organization', async () => {
      organizationsRepository.updateById.mockResolvedValue(makeOrg());

      await service.setStatus('org-1', OrganizationStatus.ACTIVE);

      expect(organizationsRepository.updateById).toHaveBeenCalledWith('org-1', {
        status: OrganizationStatus.ACTIVE,
        suspendedAt: null,
      });
    });

    it('throws NotFoundException when the organization does not exist', async () => {
      organizationsRepository.updateById.mockResolvedValue(null);

      await expect(service.setStatus('missing-org', OrganizationStatus.SUSPENDED)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assertActive', () => {
    it('does nothing for a null organizationId (PlatformAdmin)', async () => {
      await expect(service.assertActive(null)).resolves.toBeUndefined();
      expect(organizationsRepository.findById).not.toHaveBeenCalled();
    });

    it('does nothing for an active organization', async () => {
      organizationsRepository.findById.mockResolvedValue(makeOrg());
      await expect(service.assertActive('org-1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException for a suspended organization', async () => {
      organizationsRepository.findById.mockResolvedValue(
        makeOrg({ status: OrganizationStatus.SUSPENDED }),
      );
      await expect(service.assertActive('org-1')).rejects.toThrow(ForbiddenException);
    });

    it('does nothing if the organization no longer exists (fails open on lookup, not closed)', async () => {
      organizationsRepository.findById.mockResolvedValue(null);
      await expect(service.assertActive('deleted-org')).resolves.toBeUndefined();
    });
  });

  describe('stats', () => {
    it('aggregates organization and user counts', async () => {
      organizationsRepository.countAll.mockResolvedValue(5);
      usersRepository.countAll.mockResolvedValue(42);

      const result = await service.stats();

      expect(result).toEqual({ organizationCount: 5, totalUserCount: 42 });
    });
  });
});
