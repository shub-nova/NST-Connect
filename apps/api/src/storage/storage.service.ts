import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface StoredObjectInfo {
  sizeBytes: number;
  contentType: string | undefined;
}

/** Thin wrapper over an S3-compatible bucket (RustFS locally, Cloudflare R2 in production). */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly webOrigin: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.webOrigin = new URL(config.getOrThrow<string>('WEB_URL')).origin;
    this.s3 = new S3Client({
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      region: config.getOrThrow<string>('S3_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
    });
  }

  /** Create the bucket and allow browser uploads from the web app. The API still boots if storage is down. */
  async onModuleInit() {
    try {
      try {
        await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created bucket ${this.bucket}`);
      }
      // The browser uploads directly to storage with a signed URL, which is a cross-origin
      // request from the web app, so the bucket must explicitly allow that origin.
      await this.s3.send(
        new PutBucketCorsCommand({
          Bucket: this.bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: [this.webOrigin],
                AllowedMethods: ['PUT', 'GET', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3000,
              },
            ],
          },
        }),
      );
    } catch (err) {
      this.logger.warn(`Storage not ready (${(err as Error).message}). Uploads will fail until it is.`);
    }
  }

  /** A short-lived URL the browser can PUT the file to. Type and length are part of the signature. */
  presignUpload(key: string, contentType: string, sizeBytes: number, expiresInSeconds = 300) {
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes }),
      { expiresIn: expiresInSeconds },
    );
  }

  presignDownload(key: string, fileName: string, expiresInSeconds = 60) {
    const safe = encodeURIComponent(fileName);
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${safe}`,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  /** Null when the object does not exist (the client never finished uploading). */
  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch {
      return null;
    }
  }

  async readHead(key: string, bytes: number): Promise<Uint8Array> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return (await res.Body?.transformToByteArray()) ?? new Uint8Array();
  }

  async remove(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined);
  }
}
