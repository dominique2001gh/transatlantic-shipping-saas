import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { DownloadTarget, StorageProvider } from './storage.provider';

/**
 * Stage 3G: development/local storage provider — writes to disk under
 * `DOCUMENTS_STORAGE_PATH` (default `<cwd>/storage/documents`, gitignored).
 * This directory is deliberately never registered as a static-file route
 * anywhere in this app (see app.module.ts / main.ts) — the only way to
 * read a file back out is through this provider's own `getDownloadTarget`,
 * called only after DocumentsService has already confirmed the caller is
 * allowed to see this specific document. There is no public URL for any
 * file this provider stores.
 *
 * Not appropriate for a real multi-instance/production deployment (local
 * disk isn't shared across instances, isn't durable across redeploys) —
 * that's exactly the gap an object-storage provider (S3/GCS) fills later,
 * without any change to StorageProvider's interface or to
 * DocumentsService.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly basePath: string;

  constructor(config: ConfigService) {
    this.basePath = config.get<string>('DOCUMENTS_STORAGE_PATH', path.join(process.cwd(), 'storage', 'documents'));
  }

  async save(params: { tenantId: string; fileName: string; buffer: Buffer }): Promise<string> {
    const safeName = sanitizeFileName(params.fileName);
    const storageKey = `${params.tenantId}/${randomUUID()}-${safeName}`;
    const absolutePath = this.resolveWithinBase(storageKey);

    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, params.buffer);

    return storageKey;
  }

  async getDownloadTarget(storageKey: string): Promise<DownloadTarget> {
    const absolutePath = this.resolveWithinBase(storageKey);
    try {
      await fs.promises.access(absolutePath, fs.constants.R_OK);
    } catch {
      // The DB row exists (DocumentsService already confirmed ownership
      // before calling this) but the file itself is missing on disk —
      // still a 404 to the caller, not a 500, since from the caller's
      // perspective "no bytes available" is the same outcome either way.
      throw new NotFoundException('Document file not found');
    }
    return { kind: 'stream', stream: fs.createReadStream(absolutePath) };
  }

  /**
   * Defense-in-depth: every storageKey this provider ever hands out comes
   * from its own `save()` (never from raw client input), but resolving it
   * back to a path still confirms the result stays inside `basePath` —
   * a cheap guard against a path-traversal key (e.g. containing `..`)
   * ever reaching the filesystem, regardless of how it got there.
   */
  private resolveWithinBase(storageKey: string): string {
    const resolved = path.resolve(this.basePath, storageKey);
    if (!resolved.startsWith(path.resolve(this.basePath) + path.sep)) {
      throw new InternalServerErrorException('Invalid storage key');
    }
    return resolved;
  }
}

/** Strips path separators and directory-traversal segments, and caps length — the UUID prefix already guarantees uniqueness, this just keeps the human-readable suffix safe to embed in a filesystem path. */
function sanitizeFileName(original: string): string {
  const base = path.basename(original).replace(/[^a-zA-Z0-9.\-_ ]/g, '_');
  return base.slice(0, 150) || 'file';
}
