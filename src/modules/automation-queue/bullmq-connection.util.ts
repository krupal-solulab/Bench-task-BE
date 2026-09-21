import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';

/**
 * BullMQ's own Redis connection (distinct from the app's shared ioredis client in src/redis/ -
 * BullMQ requires `maxRetriesPerRequest: null` and manages its own reconnection/blocking
 * commands, so it gets a dedicated connection rather than reusing REDIS_CLIENT). Shared between
 * the producer (RealAutomationQueue, this module) and the consumer (AutomationJobProcessor,
 * TasksModule) so both point at the same Redis instance as everything else in this app. Mirrors
 * redis.module.ts's own factory logic exactly, just with BullMQ's required option added.
 */
export function createBullmqConnection(configService: ConfigService<AppConfig, true>): Redis {
  const url = configService.get('redis.url', { infer: true });
  const commonOptions = { maxRetriesPerRequest: null as null };

  if (url) {
    return new Redis(url, commonOptions);
  }
  return new Redis({
    host: configService.get('redis.host', { infer: true }),
    port: configService.get('redis.port', { infer: true }),
    password: configService.get('redis.password', { infer: true }),
    ...commonOptions,
  });
}
