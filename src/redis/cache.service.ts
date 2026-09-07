import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from './redis.constants';

const SCAN_COUNT = 200;

@Injectable()
export class CacheService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectPinoLogger(CacheService.name) private readonly logger: PinoLogger,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) {
        this.logger.debug({ key }, 'cache miss');
        return null;
      }
      this.logger.debug({ key }, 'cache hit');
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn({ key, err }, 'cache get failed, falling through');
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn({ key, err }, 'cache set failed, ignoring');
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn({ key, err }, 'cache del failed, ignoring');
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    try {
      let cursor = '0';
      let deleted = 0;
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          SCAN_COUNT,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          deleted += await this.redis.del(...keys);
        }
      } while (cursor !== '0');
      this.logger.debug({ pattern, deleted }, 'cache pattern invalidated');
      return deleted;
    } catch (err) {
      this.logger.warn({ pattern, err }, 'cache delByPattern failed, ignoring');
      return 0;
    }
  }
}
