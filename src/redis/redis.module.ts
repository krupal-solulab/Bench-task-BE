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
        return new Redis({
          host: configService.get('redis.host', { infer: true }),
          port: configService.get('redis.port', { infer: true }),
          password: configService.get('redis.password', { infer: true }),
          maxRetriesPerRequest: 2,
          lazyConnect: false,
          retryStrategy: (times: number) => Math.min(times * 200, 2000),
        });
      },
    },
    CacheService,
  ],
  exports: [CacheService, REDIS_CLIENT],
})
export class RedisModule {}
