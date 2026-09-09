import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../config/configuration';
import { IStorageService } from './storage.interface';

const DOWNLOAD_URL_EXPIRY_SECONDS = 300;

@Injectable()
export class S3StorageService implements IStorageService, OnModuleInit {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    this.bucket = this.configService.get('s3.bucket', { infer: true });
    this.client = new S3Client({
      endpoint: this.configService.get('s3.endpoint', { infer: true }),
      region: this.configService.get('s3.region', { infer: true }),
      credentials: {
        accessKeyId: this.configService.get('s3.accessKey', { infer: true }),
        secretAccessKey: this.configService.get('s3.secretKey', { infer: true }),
      },
      // MinIO (and most S3-compatible stores) serve buckets as path segments rather than
      // subdomains - the AWS SDK defaults to virtual-hosted-style addressing, which doesn't
      // resolve against a local MinIO endpoint.
      forcePathStyle: true,
    });
  }

  /** MinIO doesn't pre-provision buckets the way managed S3 does - create it on startup if missing. */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created storage bucket "${this.bucket}"`);
      } catch (createError) {
        this.logger.error(`Failed to ensure storage bucket "${this.bucket}" exists`, createError);
      }
    }
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  }

  async getDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: DOWNLOAD_URL_EXPIRY_SECONDS });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
