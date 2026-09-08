import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../config/configuration';
import { CacheService } from './cache.service';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const url = configService.get('redis.url', { infer: true });
        const commonOptions = {
          maxRetriesPerRequest: 2,
          lazyConnect: false,
          retryStrategy: (times: number) => Math.min(times * 200, 2000),
        };

        if (url) {
          // A single connection string (as given by managed providers like
          // Upstash/Render/Railway). ioredis enables TLS automatically for
          // the `rediss://` scheme those providers use.
          return new Redis(url, commonOptions);
        }

        return new Redis({
          host: configService.get('redis.host', { infer: true }),
          port: configService.get('redis.port', { infer: true }),
          password: configService.get('redis.password', { infer: true }),
          ...commonOptions,
        });
      },
    },
    CacheService,
  ],
  exports: [CacheService, REDIS_CLIENT],
})
export class RedisModule {}
