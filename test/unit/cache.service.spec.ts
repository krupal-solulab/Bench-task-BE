import type Redis from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { CacheService } from 'src/redis/cache.service';

function makeLogger(): PinoLogger {
  return { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

describe('CacheService', () => {
  let redis: jest.Mocked<Pick<Redis, 'get' | 'set' | 'del' | 'scan'>>;
  let logger: PinoLogger;
  let service: CacheService;

  beforeEach(() => {
    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      scan: jest.fn(),
    } as unknown as jest.Mocked<Pick<Redis, 'get' | 'set' | 'del' | 'scan'>>;
    logger = makeLogger();
    service = new CacheService(redis as unknown as Redis, logger);
  });

  describe('get', () => {
    it('returns the parsed value on a cache hit', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ foo: 'bar' }));
      const result = await service.get<{ foo: string }>('key-1');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('returns null on a cache miss', async () => {
      redis.get.mockResolvedValue(null);
      const result = await service.get('key-1');
      expect(result).toBeNull();
    });

    it('degrades gracefully to null and logs a warning when redis throws', async () => {
      redis.get.mockRejectedValue(new Error('connection lost'));
      const result = await service.get('key-1');
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('degrades gracefully to null when the stored value is not valid JSON', async () => {
      redis.get.mockResolvedValue('{not-json');
      const result = await service.get('key-1');
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('set', () => {
    it('serializes the value and sets it with the given TTL', async () => {
      await service.set('key-1', { foo: 'bar' }, 60);
      expect(redis.set).toHaveBeenCalledWith('key-1', JSON.stringify({ foo: 'bar' }), 'EX', 60);
    });

    it('swallows redis errors instead of throwing', async () => {
      redis.set.mockRejectedValue(new Error('connection lost'));
      await expect(service.set('key-1', { foo: 'bar' }, 60)).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('del', () => {
    it('deletes the given key', async () => {
      await service.del('key-1');
      expect(redis.del).toHaveBeenCalledWith('key-1');
    });

    it('swallows redis errors instead of throwing', async () => {
      redis.del.mockRejectedValue(new Error('connection lost'));
      await expect(service.del('key-1')).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('delByPattern', () => {
    it('scans and deletes all matching keys across multiple cursor pages', async () => {
      redis.scan
        .mockResolvedValueOnce(['17', ['dash:v1:a', 'dash:v1:b']])
        .mockResolvedValueOnce(['0', ['dash:v1:c']]);
      redis.del.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

      const deleted = await service.delByPattern('dash:v1:*');

      expect(deleted).toBe(3);
      expect(redis.del).toHaveBeenNthCalledWith(1, 'dash:v1:a', 'dash:v1:b');
      expect(redis.del).toHaveBeenNthCalledWith(2, 'dash:v1:c');
    });

    it('returns 0 without calling del when no keys match', async () => {
      redis.scan.mockResolvedValueOnce(['0', []]);
      const deleted = await service.delByPattern('dash:v1:*');
      expect(deleted).toBe(0);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('degrades gracefully to 0 and logs a warning when redis throws', async () => {
      redis.scan.mockRejectedValue(new Error('connection lost'));
      const deleted = await service.delByPattern('dash:v1:*');
      expect(deleted).toBe(0);
      expect(logger.warn).toHaveBeenCalled();
    });
  });
});
