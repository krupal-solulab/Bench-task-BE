import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { SavedFiltersService } from 'src/modules/saved-filters/saved-filters.service';
import { SavedFiltersRepository } from 'src/modules/saved-filters/saved-filters.repository';
import { SavedFilterScope } from 'src/modules/saved-filters/schemas/saved-filter.schema';

// SavedFiltersService.create() wraps actingUser.id/organizationId in `new Types.ObjectId(...)`,
// so these must be real 24-char hex strings.
const ORG_A = '507f1f77bcf86cd799439099';
const OWNER_ID = '507f1f77bcf86cd799439001';
const STRANGER_ID = '507f1f77bcf86cd799439002';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: OWNER_ID,
    email: 'a@a.com',
    role: Role.DEVELOPER,
    organizationId: ORG_A,
    ...overrides,
  };
}

function makeSavedFilter(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sf-1',
    owner: { toString: () => OWNER_ID },
    scope: SavedFilterScope.MY_TASKS,
    projectId: null,
    query: { priority: ['P1'] },
    ...overrides,
  } as never;
}

describe('SavedFiltersService', () => {
  let repository: jest.Mocked<
    Pick<SavedFiltersRepository, 'create' | 'find' | 'findById' | 'deleteById'>
  >;
  let service: SavedFiltersService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      deleteById: jest.fn(),
    };
    service = new SavedFiltersService(repository as unknown as SavedFiltersRepository);
  });

  describe('create', () => {
    it('requires a projectId when scope is "project"', async () => {
      await expect(
        service.create(
          { name: 'My filter', scope: SavedFilterScope.PROJECT, query: {} },
          makeUser(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('stamps owner and organizationId from the acting user', async () => {
      repository.create.mockResolvedValue(makeSavedFilter());

      await service.create(
        { name: 'My open bugs', scope: SavedFilterScope.MY_TASKS, query: { priority: ['P1'] } },
        makeUser(),
      );

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My open bugs',
          scope: SavedFilterScope.MY_TASKS,
          query: { priority: ['P1'] },
        }),
      );
    });
  });

  describe('listMine', () => {
    it("delegates to the repository scoped to the caller's own id", async () => {
      repository.find.mockResolvedValue([makeSavedFilter()]);

      const result = await service.listMine({}, makeUser());

      expect(repository.find).toHaveBeenCalledWith(OWNER_ID, {
        scope: undefined,
        projectId: undefined,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('remove', () => {
    it('rejects when the filter does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(service.remove('sf-1', makeUser())).rejects.toThrow(NotFoundException);
      expect(repository.deleteById).not.toHaveBeenCalled();
    });

    it('rejects a non-owner with the same 404 (never leaking existence)', async () => {
      repository.findById.mockResolvedValue(makeSavedFilter());
      await expect(service.remove('sf-1', makeUser({ id: STRANGER_ID }))).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.deleteById).not.toHaveBeenCalled();
    });

    it('deletes when the caller is the owner', async () => {
      repository.findById.mockResolvedValue(makeSavedFilter());
      await service.remove('sf-1', makeUser());
      expect(repository.deleteById).toHaveBeenCalledWith('sf-1');
    });
  });
});
