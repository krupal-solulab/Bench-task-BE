import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { AuditLogRepository } from './audit-log.repository';
import { AuditAction } from './schemas/audit-log-entry.schema';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

export interface RecordAuditEntry {
  organizationId: string;
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Module 8's Admin Audit Log service. `record()` follows the same "never break the caller"
 * contract as NotificationsService's in-app notification writes: every failure is caught and
 * logged, never thrown - an admin action (creating a user, deleting a scheme, ...) must never fail
 * because the audit trail couldn't be written.
 */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly auditLogRepository: AuditLogRepository,
    @InjectPinoLogger(AuditLogService.name) private readonly logger: PinoLogger,
  ) {}

  async record(entry: RecordAuditEntry): Promise<void> {
    try {
      await this.auditLogRepository.create({
        organizationId: entry.organizationId,
        actor: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        targetLabel: entry.targetLabel ?? null,
        metadata: entry.metadata ?? {},
      });
    } catch (err) {
      this.logger.warn(
        { err, action: entry.action, organizationId: entry.organizationId },
        'failed to write an audit log entry, ignoring',
      );
    }
  }

  async paginate(organizationId: string, query: ListAuditLogDto) {
    const { data, total } = await this.auditLogRepository.paginate(organizationId, query);
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }
}
