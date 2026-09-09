import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { ApiLogsRepository, CreateApiLogData } from './api-logs.repository';
import { ListApiLogsDto } from './dto/list-api-logs.dto';

@Injectable()
export class ApiLogsService {
  constructor(
    private readonly apiLogsRepository: ApiLogsRepository,
    @InjectPinoLogger(ApiLogsService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Fire-and-forget by design (never awaited by the interceptor that calls this) - persisting a
   * log entry must never add latency to the request it's describing, and a failure to persist
   * one must never surface as an error to the client.
   */
  async record(data: CreateApiLogData): Promise<void> {
    try {
      await this.apiLogsRepository.create(data);
    } catch (err) {
      this.logger.warn({ err }, 'failed to persist api log entry, ignoring');
    }
  }

  async paginate(query: ListApiLogsDto) {
    const { data, total } = await this.apiLogsRepository.paginate(query);
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }
}
