import { IStorageService } from 'src/storage/storage.interface';

/**
 * In-memory stand-in for S3StorageService so integration tests never need a real MinIO
 * container. Mirrors FakeRedis's role: same interface, backed by a plain Map.
 */
export class FakeStorageService implements IStorageService {
  private readonly store = new Map<string, Buffer>();

  async upload(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
    this.store.set(key, buffer);
  }

  async getDownloadUrl(key: string): Promise<string> {
    return `https://fake-storage.test/${encodeURIComponent(key)}`;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }
}
