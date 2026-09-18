export interface IStorageService {
  upload(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  getDownloadUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
  /** Integration Health (Role-surface polish) - never throws, so a down/misconfigured backend
   * surfaces as a clean `false` on the health page rather than an error. */
  healthCheck(): Promise<boolean>;
}
