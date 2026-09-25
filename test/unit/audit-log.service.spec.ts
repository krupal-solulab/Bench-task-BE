import { PinoLogger } from 'nestjs-pino';
import { AuditLogService } from 'src/modules/audit-log/audit-log.service';
import { AuditLogRepository } from 'src/modules/audit-log/audit-log.repository';
import { AuditAction } from 'src/modules/audit-log/schemas/audit-log-entry.schema';

const ORG_ID = '507f1f77bcf86cd799439099';
const ACTOR_ID = '507f1f77bcf86cd799439001';

function makeLogger(): PinoLogger {
  return { warn: jest.fn(), info: jest.fn() } as unknown as PinoLogger;
}

describe('AuditLogService', () => {
  let repository: jest.Mocked<Pick<AuditLogRepository, 'create' | 'paginate'>>;
  let logger: PinoLogger;
  let service: AuditLogService;

  beforeEach(() => {
    repository = { create: jest.fn(), paginate: jest.fn() };
    logger = makeLogger();
    service = new AuditLogService(repository as unknown as AuditLogRepository, logger);
  });

  describe('record', () => {
    it('maps actorId to actor and defaults an omitted targetId/targetLabel/metadata', async () => {
      repository.create.mockResolvedValue({} as never);

      await service.record({
        organizationId: ORG_ID,
        actorId: ACTOR_ID,
        action: AuditAction.TEAM_CREATED,
        targetType: 'Team',
      });

      expect(repository.create).toHaveBeenCalledWith({
        organizationId: ORG_ID,
        actor: ACTOR_ID,
        action: AuditAction.TEAM_CREATED,
        targetType: 'Team',
        targetId: null,
        targetLabel: null,
        metadata: {},
      });
    });

    it('passes through an explicit targetId/targetLabel/metadata unchanged', async () => {
      repository.create.mockResolvedValue({} as never);

      await service.record({
        organizationId: ORG_ID,
        actorId: ACTOR_ID,
        action: AuditAction.USER_ROLE_CHANGED,
        targetType: 'User',
        targetId: 'user-1',
        targetLabel: 'Dana Developer',
        metadata: { from: 'Developer', to: 'Manager' },
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: 'user-1',
          targetLabel: 'Dana Developer',
          metadata: { from: 'Developer', to: 'Manager' },
        }),
      );
    });

    it('swallows a repository failure, logs a warning, and never throws (never-break-the-caller)', async () => {
      repository.create.mockRejectedValue(new Error('mongo down'));

      await expect(
        service.record({
          organizationId: ORG_ID,
          actorId: ACTOR_ID,
          action: AuditAction.TEAM_DELETED,
          targetType: 'Team',
        }),
      ).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.TEAM_DELETED, organizationId: ORG_ID }),
        expect.any(String),
      );
    });
  });

  describe('paginate', () => {
    it('wraps the repository result in a pagination meta envelope', async () => {
      const entries = [{ id: 'a' }, { id: 'b' }] as never;
      repository.paginate.mockResolvedValue({ data: entries, total: 42 });

      const result = await service.paginate(ORG_ID, {
        page: 2,
        limit: 10,
        sortOrder: 'desc',
      } as never);

      expect(repository.paginate).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ page: 2, limit: 10 }),
      );
      expect(result.data).toBe(entries);
      expect(result.meta).toMatchObject({
        total: 42,
        page: 2,
        limit: 10,
        totalPages: 5,
        hasNextPage: true,
        hasPrevPage: true,
      });
    });
  });
});
