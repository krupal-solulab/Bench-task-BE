export interface IStorageService {
  upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  getDownloadUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}
