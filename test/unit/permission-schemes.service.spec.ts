import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { UsersRepository } from 'src/modules/users/users.repository';
import { PermissionSchemesService } from 'src/permission-schemes/permission-schemes.service';
import { PermissionSchemesRepository } from 'src/permission-schemes/permission-schemes.repository';
import { SchemeAction } from 'src/permission-schemes/schemas/permission-scheme.schema';

// PermissionSchemesService wraps ids in `new Types.ObjectId(...)`, so these must be real
// 24-char hex strings.
const ORG_A = '507f1f77bcf86cd799439099';
const ORG_B = '507f1f77bcf86cd799439098';
const ADMIN_ID = '507f1f77bcf86cd799439001';
const DEV_ID = '507f1f77bcf86cd799439002';
const SCHEME_ID = '507f1f77bcf86cd799439010';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { id: ADMIN_ID, email: 'a@a.com', role: Role.ADMIN, organizationId: ORG_A, ...overrides };
}

function makeScheme(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SCHEME_ID,
    organizationId: { toString: () => ORG_A },
    name: 'Strict',
    grants: [
      { action: SchemeAction.CREATE_ISSUE, allowedRoles: [Role.DEVELOPER], allowedUserIds: [] },
    ],
    ...overrides,
  } as never;
}

describe('PermissionSchemesService', () => {
  let repository: jest.Mocked<
    Pick<
      PermissionSchemesRepository,
      'create' | 'findById' | 'findByOrganization' | 'updateById' | 'deleteById'
    >
  >;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findByIds'>>;
  let projectModel: { exists: jest.Mock };
  let teamModel: { countDocuments: jest.Mock };
  let projectRoleModel: { countDocuments: jest.Mock };
  let service: PermissionSchemesService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findById: jest.fn(),
      findByOrganization: jest.fn(),
      updateById: jest.fn(),
      deleteById: jest.fn(),
    };
    usersRepository = { findByIds: jest.fn() };
    projectModel = { exists: jest.fn().mockResolvedValue(null) };
    teamModel = { countDocuments: jest.fn().mockResolvedValue(0) };
    projectRoleModel = { countDocuments: jest.fn().mockResolvedValue(0) };
    service = new PermissionSchemesService(
      repository as unknown as PermissionSchemesRepository,
      usersRepository as unknown as UsersRepository,
      projectModel as never,
      teamModel as never,
      projectRoleModel as never,
    );
  });

  describe('create', () => {
    it('stamps organizationId from the acting user and creates the scheme', async () => {
      repository.create.mockResolvedValue(makeScheme());

      await service.create(
        {
          name: 'Strict',
          grants: [
            {
              action: SchemeAction.CREATE_ISSUE,
              allowedRoles: [Role.DEVELOPER],
              allowedUserIds: [],
            },
          ],
        },
        makeUser(),
      );

      expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Strict' }));
    });

    it('rejects a grant naming a user id outside the organization', async () => {
      usersRepository.findByIds.mockResolvedValue([]);

      await expect(
        service.create(
          {
            name: 'Strict',
            grants: [{ action: SchemeAction.DELETE, allowedRoles: [], allowedUserIds: [DEV_ID] }],
          },
          makeUser(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('listMine', () => {
    it("delegates to the repository scoped to the caller's own organization", async () => {
      repository.findByOrganization.mockResolvedValue([makeScheme()]);
      const result = await service.listMine(makeUser());
      expect(repository.findByOrganization).toHaveBeenCalledWith(ORG_A);
      expect(result).toHaveLength(1);
    });
  });

  describe('update / remove (org-scoped 404)', () => {
    it('rejects updating a scheme from a different organization with 404', async () => {
      repository.findById.mockResolvedValue(
        makeScheme({ organizationId: { toString: () => ORG_B } }),
      );
      await expect(service.update(SCHEME_ID, { name: 'Renamed' }, makeUser())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects deleting a scheme currently assigned to a project', async () => {
      repository.findById.mockResolvedValue(makeScheme());
      projectModel.exists.mockResolvedValue({ _id: 'p1' });

      await expect(service.remove(SCHEME_ID, makeUser())).rejects.toThrow(BadRequestException);
      expect(repository.deleteById).not.toHaveBeenCalled();
    });

    it('deletes a scheme not assigned to any project', async () => {
      repository.findById.mockResolvedValue(makeScheme());
      projectModel.exists.mockResolvedValue(null);

      await service.remove(SCHEME_ID, makeUser());
      expect(repository.deleteById).toHaveBeenCalledWith(SCHEME_ID);
    });
  });

  describe('findByIdOrNull', () => {
    it('returns whatever the repository returns, with no org check (internal use only)', async () => {
      repository.findById.mockResolvedValue(makeScheme());
      const result = await service.findByIdOrNull(SCHEME_ID);
      expect(result).not.toBeNull();
    });
  });
});
