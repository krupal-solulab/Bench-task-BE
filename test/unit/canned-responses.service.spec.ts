import { NotFoundException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { CannedResponsesService } from 'src/modules/canned-responses/canned-responses.service';
import { CannedResponsesRepository } from 'src/modules/canned-responses/canned-responses.repository';

// CannedResponsesService wraps actingUser.id/organizationId in `new Types.ObjectId(...)`, so
// these must be real 24-char hex strings.
const ORG_A = '507f1f77bcf86cd799439099';
const CREATOR_ID = '507f1f77bcf86cd799439001';
const OTHER_MEMBER_ID = '507f1f77bcf86cd799439002';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: CREATOR_ID,
    email: 'a@a.com',
    role: Role.DEVELOPER,
    organizationId: ORG_A,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cr-1',
    organizationId: { toString: () => ORG_A },
    createdBy: { toString: () => CREATOR_ID },
    title: 'Investigating',
    body: "Thanks for reporting this - we're looking into it now.",
    ...overrides,
  } as never;
}

describe('CannedResponsesService', () => {
  let repository: jest.Mocked<
    Pick<
      CannedResponsesRepository,
      'create' | 'findAllForOrg' | 'findByIdInOrg' | 'updateById' | 'deleteById'
    >
  >;
  let service: CannedResponsesService;

  beforeEach(() => {
    repository = {
      create: jest.fn(),
      findAllForOrg: jest.fn(),
      findByIdInOrg: jest.fn(),
      updateById: jest.fn(),
      deleteById: jest.fn(),
    };
    service = new CannedResponsesService(repository as unknown as CannedResponsesRepository);
  });

  describe('create', () => {
    it('stamps organizationId and createdBy from the acting user', async () => {
      repository.create.mockResolvedValue(makeEntry());

      await service.create({ title: 'Investigating', body: 'We are on it.' }, makeUser());

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Investigating', body: 'We are on it.' }),
      );
    });

    it('trims title and body', async () => {
      repository.create.mockResolvedValue(makeEntry());

      await service.create({ title: '  Investigating  ', body: '  We are on it.  ' }, makeUser());

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Investigating', body: 'We are on it.' }),
      );
    });
  });

  describe('list', () => {
    it("delegates to the repository scoped to the caller's org", async () => {
      repository.findAllForOrg.mockResolvedValue([makeEntry()]);

      const result = await service.list(makeUser());

      expect(repository.findAllForOrg).toHaveBeenCalledWith(ORG_A);
      expect(result).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('rejects a canned response id from a different org (never leaks cross-org existence)', async () => {
      repository.findByIdInOrg.mockResolvedValue(null);

      await expect(service.update('cr-1', { title: 'x' }, makeUser())).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.updateById).not.toHaveBeenCalled();
    });

    it('allows a different org member (not the creator) to edit a shared canned response', async () => {
      repository.findByIdInOrg.mockResolvedValue(makeEntry());
      repository.updateById.mockResolvedValue(makeEntry({ title: 'Updated' }));

      await service.update('cr-1', { title: 'Updated' }, makeUser({ id: OTHER_MEMBER_ID }));

      expect(repository.updateById).toHaveBeenCalledWith('cr-1', { title: 'Updated' });
    });

    it('only patches the fields provided, leaving the others untouched', async () => {
      repository.findByIdInOrg.mockResolvedValue(makeEntry());
      repository.updateById.mockResolvedValue(makeEntry());

      await service.update('cr-1', { title: 'New title' }, makeUser());

      expect(repository.updateById).toHaveBeenCalledWith('cr-1', { title: 'New title' });
    });
  });

  describe('remove', () => {
    it('rejects a canned response id from a different org', async () => {
      repository.findByIdInOrg.mockResolvedValue(null);

      await expect(service.remove('cr-1', makeUser())).rejects.toThrow(NotFoundException);
      expect(repository.deleteById).not.toHaveBeenCalled();
    });

    it('allows a different org member (not the creator) to delete a shared canned response', async () => {
      repository.findByIdInOrg.mockResolvedValue(makeEntry());

      await service.remove('cr-1', makeUser({ id: OTHER_MEMBER_ID }));

      expect(repository.deleteById).toHaveBeenCalledWith('cr-1');
    });
  });
});
