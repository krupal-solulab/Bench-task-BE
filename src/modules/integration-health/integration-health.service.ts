import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { CacheService } from '../../redis/cache.service';
import { STORAGE_SERVICE } from '../../storage/storage.constants';
import { IStorageService } from '../../storage/storage.interface';

export type IntegrationHealthStatus = 'ok' | 'error' | 'stub';

export interface IntegrationHealthEntry {
  name: string;
  status: IntegrationHealthStatus;
  detail: string;
}

/**
 * Real, cheaply-obtainable status for every integration already wired into this app - not
 * fabricated data (Role-surface polish decision #2). A failing local-dev Redis/S3 is expected and
 * correctly reported as unhealthy, not hidden or treated as a bug to fix here.
 */
@Injectable()
export class IntegrationHealthService {
  constructor(
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly cacheService: CacheService,
    @Inject(STORAGE_SERVICE) private readonly storageService: IStorageService,
  ) {}

  async check(): Promise<IntegrationHealthEntry[]> {
    const [mongo, redis, storage] = await Promise.allSettled([
      this.checkMongo(),
      this.cacheService.ping(),
      this.storageService.healthCheck(),
    ]);

    return [
      this.toEntry('MongoDB', mongo),
      this.toEntry('Redis', redis),
      this.toEntry('Object storage (S3/MinIO)', storage),
      {
        name: 'Email',
        status: 'stub',
        detail: 'Logging-only stub - no real email provider is configured for this project.',
      },
    ];
  }

  private async checkMongo(): Promise<boolean> {
    // 1 === connected, per mongoose.Connection.readyState's documented enum.
    return this.mongoConnection.readyState === 1;
  }

  private toEntry(name: string, result: PromiseSettledResult<boolean>): IntegrationHealthEntry {
    const healthy = result.status === 'fulfilled' && result.value;
    return {
      name,
      status: healthy ? 'ok' : 'error',
      detail: healthy ? 'Reachable.' : 'Unreachable or misconfigured.',
    };
  }
}
