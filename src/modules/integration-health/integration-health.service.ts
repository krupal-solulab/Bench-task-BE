import { Inject, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { CacheService } from '../../redis/cache.service';
import { STORAGE_SERVICE } from '../../storage/storage.constants';
import { IStorageService } from '../../storage/storage.interface';
import {
  ChannelStatusService,
  PausableNotificationChannel,
} from '../../notifications/channel-status.service';

export type IntegrationHealthStatus = 'ok' | 'error' | 'stub';

export interface IntegrationHealthEntry {
  name: string;
  status: IntegrationHealthStatus;
  detail: string;
  // Only set for Email/WhatsApp (BRD 8's Platform Admin pause/resume) - undefined for every other
  // row, which stays purely display-only (Mongo/Redis/S3 aren't "pausable" without breaking the
  // app).
  paused?: boolean;
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
    private readonly channelStatusService: ChannelStatusService,
  ) {}

  async check(): Promise<IntegrationHealthEntry[]> {
    const [mongo, redis, storage, emailPaused, whatsappPaused] = await Promise.allSettled([
      this.checkMongo(),
      this.cacheService.ping(),
      this.storageService.healthCheck(),
      this.channelStatusService.isPaused('Email'),
      this.channelStatusService.isPaused('WhatsApp'),
    ]);

    return [
      this.toEntry('MongoDB', mongo),
      this.toEntry('Redis', redis),
      this.toEntry('Object storage (S3/MinIO)', storage),
      {
        name: 'Email',
        status: 'stub',
        detail: 'Logging-only stub - no real email provider is configured for this project.',
        paused: emailPaused.status === 'fulfilled' && emailPaused.value,
      },
      {
        name: 'WhatsApp',
        status: 'stub',
        detail: 'Logging-only stub - no real WhatsApp provider is configured for this project.',
        paused: whatsappPaused.status === 'fulfilled' && whatsappPaused.value,
      },
    ];
  }

  async setChannelPaused(channel: PausableNotificationChannel, paused: boolean): Promise<void> {
    await this.channelStatusService.setPaused(channel, paused);
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
