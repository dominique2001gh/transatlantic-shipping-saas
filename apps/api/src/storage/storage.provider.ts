import { Readable } from 'stream';

/**
 * Stage 3G: injection token for whichever StorageProvider is active — the
 * DI-token indirection is what lets a later provider (S3, GCS, ...) swap
 * in via StorageModule alone, with zero changes anywhere that injects
 * this token (DocumentsService, most notably). See StorageModule's own
 * doc comment for how the active provider is selected.
 */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

/**
 * What a download resolves to. `stream` is what a local-disk provider
 * returns — this app's own HTTP response streams the bytes directly.
 * `redirect` is what an object-storage provider (S3/GCS) is expected to
 * return instead — a short-lived, provider-signed URL the browser is
 * redirected to, so file bytes never flow back through this API at all.
 * Every consumer of a StorageProvider (right now, just
 * DocumentsController's two download handlers) already branches on
 * `kind`, so adding a provider that only ever returns `redirect` requires
 * no changes there — this is the concrete mechanism behind "provider-agnostic,
 * no redesign needed later."
 */
export type DownloadTarget =
  | { kind: 'stream'; stream: Readable; contentLength?: number }
  | { kind: 'redirect'; url: string };

/**
 * Stage 3G: the only interface DocumentsService is allowed to depend on
 * for file bytes — it never touches the filesystem, `multer`, or any
 * cloud SDK directly. `storageKey` is intentionally opaque to every
 * caller outside the active provider: DocumentsService stores whatever
 * string a provider's `save()` returns in `Document.fileUrl` and hands
 * that same string back to `getDownloadTarget()` unexamined. Providers
 * are free to give that string any internal structure they want (a local
 * relative path today; an S3 object key tomorrow) without any other file
 * in this codebase needing to change.
 */
export interface StorageProvider {
  save(params: { tenantId: string; fileName: string; buffer: Buffer }): Promise<string>;
  getDownloadTarget(storageKey: string): Promise<DownloadTarget>;
}
