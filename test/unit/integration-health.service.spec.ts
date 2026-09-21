import { CacheService } from 'src/redis/cache.service';
import { IStorageService } from 'src/storage/storage.interface';
import { ChannelStatusService } from 'src/notifications/channel-status.service';
import { IntegrationHealthService } from 'src/modules/integration-health/integration-health.service';

function makeConnection(readyState: number) {
  return { readyState } as never;
}

describe('IntegrationHealthService', () => {
  let cacheService: jest.Mocked<Pick<CacheService, 'ping'>>;
  let storageService: jest.Mocked<IStorageService>;
  let channelStatusService: jest.Mocked<Pick<ChannelStatusService, 'isPaused' | 'setPaused'>>;

  function makeService(readyState = 1) {
    return new IntegrationHealthService(
      makeConnection(readyState),
      cacheService as unknown as CacheService,
      storageService,
      channelStatusService as unknown as ChannelStatusService,
    );
  }

  beforeEach(() => {
    cacheService = { ping: jest.fn().mockResolvedValue(true) };
    storageService = {
      upload: jest.fn(),
      getDownloadUrl: jest.fn(),
      delete: jest.fn(),
      healthCheck: jest.fn().mockResolvedValue(true),
    };
    channelStatusService = {
      isPaused: jest.fn().mockResolvedValue(false),
      setPaused: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('reports every integration ok when all probes succeed', async () => {
    const service = makeService(1);
    const result = await service.check();

    const byName = Object.fromEntries(result.map((r) => [r.name, r.status]));
    expect(byName['MongoDB']).toBe('ok');
    expect(byName['Redis']).toBe('ok');
    expect(byName['Object storage (S3/MinIO)']).toBe('ok');
    expect(byName['Email']).toBe('stub');
  });

  it('reports MongoDB as an error when the connection is not in the connected state', async () => {
    const service = makeService(0); // 0 = disconnected
    const result = await service.check();

    expect(result.find((r) => r.name === 'MongoDB')?.status).toBe('error');
  });

  it('reports Redis as an error when ping fails, without affecting other entries', async () => {
    cacheService.ping.mockResolvedValue(false);
    const service = makeService(1);
    const result = await service.check();

    const byName = Object.fromEntries(result.map((r) => [r.name, r.status]));
    expect(byName['Redis']).toBe('error');
    expect(byName['MongoDB']).toBe('ok');
    expect(byName['Object storage (S3/MinIO)']).toBe('ok');
  });

  it('reports storage as an error when the probe rejects, without affecting other entries', async () => {
    storageService.healthCheck.mockRejectedValue(new Error('bucket not found'));
    const service = makeService(1);
    const result = await service.check();

    const byName = Object.fromEntries(result.map((r) => [r.name, r.status]));
    expect(byName['Object storage (S3/MinIO)']).toBe('error');
    expect(byName['MongoDB']).toBe('ok');
    expect(byName['Redis']).toBe('ok');
  });

  it('always reports Email as a stub, regardless of the other integrations', async () => {
    cacheService.ping.mockResolvedValue(false);
    storageService.healthCheck.mockResolvedValue(false);
    const service = makeService(0);
    const result = await service.check();

    expect(result.find((r) => r.name === 'Email')?.status).toBe('stub');
  });

  it('always reports WhatsApp as a stub', async () => {
    const service = makeService();
    const result = await service.check();

    expect(result.find((r) => r.name === 'WhatsApp')?.status).toBe('stub');
  });

  it("reports Email/WhatsApp's paused state from ChannelStatusService, undefined for every other row", async () => {
    channelStatusService.isPaused.mockImplementation(async (channel) => channel === 'Email');
    const service = makeService();
    const result = await service.check();

    expect(result.find((r) => r.name === 'Email')?.paused).toBe(true);
    expect(result.find((r) => r.name === 'WhatsApp')?.paused).toBe(false);
    expect(result.find((r) => r.name === 'MongoDB')?.paused).toBeUndefined();
  });

  it('setChannelPaused delegates to ChannelStatusService', async () => {
    const service = makeService();
    await service.setChannelPaused('WhatsApp', true);

    expect(channelStatusService.setPaused).toHaveBeenCalledWith('WhatsApp', true);
  });
});
