import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { Readable } from 'stream';
import type { DownloadTarget, StorageProvider } from './storage.provider';

/**
 * Website Launch (Step 4): Cloudflare R2 storage provider. R2 speaks the
 * S3 API, so this uses the standard AWS SDK v3 S3Client pointed at R2's
 * account-specific endpoint rather than a Cloudflare-specific SDK — the
 * only R2-specific things here are the endpoint URL and `region: 'auto'`
 * (R2's documented convention; the value is otherwise ignored by R2).
 *
 * Bucket contents are private — every object is written with no public
 * ACL. getDownloadTarget() fetches the object itself (server-to-server,
 * via this same S3Client) and hands the response body back as a stream
 * for DocumentsController's sendDownload() to pipe to the client — the
 * exact same `{ kind: 'stream' }` shape LocalStorageProvider already
 * returns, so the browser only ever talks to this API, never to R2
 * directly. This is deliberate, not an oversight: an earlier version of
 * this method returned a presigned redirect URL instead, which works
 * correctly server-side (object, credentials, and signature all valid)
 * but fails in every real browser — a fetch() that follows a
 * cross-origin redirect sends `Origin: null` on the final request (a
 * WHATWG Fetch spec behavior, not a bug), which no legitimate R2 CORS
 * policy can both accept and stay secure (allowing `null`/`*` would
 * accept the same header a sandboxed iframe or `file://` page can send).
 * Streaming through the API sidesteps the whole class of problem — R2's
 * CORS policy becomes irrelevant to this flow, since the browser never
 * makes a cross-origin request to R2 at all.
 *
 * StorageModule always constructs one instance of every provider (Nest
 * resolves whatever the factory function injects, eagerly, before it can
 * even check STORAGE_DRIVER) — so this provider is instantiated in every
 * environment, including local dev with no R2 credentials configured.
 * Reading R2_* env vars is therefore deliberately deferred to first use
 * (`client` getter), not done in the constructor, so an environment that
 * never actually calls save()/getDownloadTarget() on this provider (i.e.
 * STORAGE_DRIVER=local) is completely unaffected by missing R2 config.
 */
@Injectable()
export class R2StorageProvider implements StorageProvider {
  private cachedClient: S3Client | undefined;
  private cachedBucket: string | undefined;

  constructor(private readonly config: ConfigService) {}

  async save(params: { tenantId: string; fileName: string; buffer: Buffer }): Promise<string> {
    const safeName = sanitizeFileName(params.fileName);
    const storageKey = `${params.tenantId}/${randomUUID()}-${safeName}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: params.buffer,
      }),
    );

    return storageKey;
  }

  async getDownloadTarget(storageKey: string): Promise<DownloadTarget> {
    let body: Readable | undefined;
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
      // Body's SDK type is a cross-environment union (Readable | ReadableStream | Blob)
      // since the same client type serves both Node and browser consumers — this
      // provider only ever runs in this Node API, where it's always a Readable.
      body = object.Body as Readable;
    } catch (err) {
      // Mirrors LocalStorageProvider's own "DB row exists but bytes don't" handling:
      // a missing R2 object surfaces as the same 404 a caller would see for any
      // other "no bytes available" reason, not a 500.
      const code = (err as { name?: string })?.name;
      if (code === 'NoSuchKey') {
        throw new NotFoundException('Document file not found');
      }
      throw err;
    }
    return { kind: 'stream', stream: body };
  }

  private get bucket(): string {
    this.cachedBucket ??= requireEnv(this.config, 'R2_BUCKET_NAME');
    return this.cachedBucket;
  }

  private get client(): S3Client {
    if (!this.cachedClient) {
      const accountId = requireEnv(this.config, 'R2_ACCOUNT_ID');
      const accessKeyId = requireEnv(this.config, 'R2_ACCESS_KEY_ID');
      const secretAccessKey = requireEnv(this.config, 'R2_SECRET_ACCESS_KEY');
      this.cachedClient = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
    return this.cachedClient;
  }
}

function requireEnv(config: ConfigService, key: string): string {
  const value = config.get<string>(key);
  if (!value) {
    throw new InternalServerErrorException(`Missing required env var "${key}" for STORAGE_DRIVER=r2`);
  }
  return value;
}

/** Mirrors LocalStorageProvider's own sanitizer — see its doc comment. */
function sanitizeFileName(original: string): string {
  const base = path.basename(original).replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
  return base.slice(0, 150) || 'file';
}
